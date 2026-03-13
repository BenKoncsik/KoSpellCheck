using System.Reflection;
using System.Text.RegularExpressions;
using KoSpellCheck.Core.ProjectConventions.Abstractions;
using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.ProjectConventions.Models;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace KoSpellCheck.Core.ProjectConventions.Scanning;

public sealed class DotNetTypeUsageAnalyzer
{
    private static readonly HashSet<string> DiRegistrationMethods = new(StringComparer.Ordinal)
    {
        "AddScoped",
        "AddTransient",
        "AddSingleton",
    };

    private static readonly Regex TypeNameLiteralRegex =
        new("[A-Za-z_][A-Za-z0-9_+]*(?:\\.[A-Za-z_][A-Za-z0-9_+]*)*", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly MetadataReference[] MetadataReferences = BuildMetadataReferences();

    private readonly IWorkspaceFileProvider _workspaceFileProvider;
    private readonly ITextFileReader _textFileReader;
    private readonly ProjectConventionSymbolExtractor _symbolExtractor;

    public DotNetTypeUsageAnalyzer(
        IWorkspaceFileProvider workspaceFileProvider,
        ITextFileReader textFileReader,
        ProjectConventionSymbolExtractor symbolExtractor)
    {
        _workspaceFileProvider = workspaceFileProvider;
        _textFileReader = textFileReader;
        _symbolExtractor = symbolExtractor;
    }

    public IReadOnlyList<TypeUsageFacts> Analyze(
        string workspaceRoot,
        string targetFilePath,
        string targetFileContent,
        ProjectConventionOptions options)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot) ||
            string.IsNullOrWhiteSpace(targetFilePath) ||
            !string.Equals(Path.GetExtension(targetFilePath), ".cs", StringComparison.OrdinalIgnoreCase))
        {
            return Array.Empty<TypeUsageFacts>();
        }

        var files = BuildWorkspaceFileStates(workspaceRoot, targetFilePath, targetFileContent, options);
        if (files.Count == 0)
        {
            return Array.Empty<TypeUsageFacts>();
        }

        var normalizedTarget = NormalizePath(targetFilePath);
        var targetFile = files.FirstOrDefault(file => string.Equals(file.NormalizedPath, normalizedTarget, StringComparison.Ordinal));
        if (targetFile == null)
        {
            return Array.Empty<TypeUsageFacts>();
        }

        var declarations = CollectTargetDeclarations(targetFile);
        if (declarations.Count == 0)
        {
            return Array.Empty<TypeUsageFacts>();
        }

        var stageOne = RunStageOnePrefilter(files, targetFile, declarations);
        var stageTwoCandidates = stageOne
            .Where(entry => !entry.Value.HasStrongProductionSignal)
            .Select(entry => entry.Key)
            .ToList();

        var output = new List<TypeUsageFacts>();

        if (stageTwoCandidates.Count == 0)
        {
            output.AddRange(stageOne.Keys.Select(candidate => CreateUsedByStageOne(candidate, stageOne[candidate])));
            return output;
        }

        var compilation = CSharpCompilation.Create(
            assemblyName: "KoSpellCheck.ProjectConventions.Usage",
            syntaxTrees: files.Select(file => file.Tree),
            references: MetadataReferences,
            options: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

        var semanticModels = files.ToDictionary(
            file => file.NormalizedPath,
            file => compilation.GetSemanticModel(file.Tree),
            StringComparer.Ordinal);

        var nodesByName = IndexSimpleNameNodes(files);
        var invocations = files.ToDictionary(
            file => file.NormalizedPath,
            file => file.Root.DescendantNodes().OfType<InvocationExpressionSyntax>().ToList(),
            StringComparer.Ordinal);

        var symbolMap = new Dictionary<TypeDeclarationSyntax, INamedTypeSymbol>();
        var targetModel = semanticModels[targetFile.NormalizedPath];
        foreach (var declaration in stageTwoCandidates)
        {
            if (targetModel.GetDeclaredSymbol(declaration.Declaration) is INamedTypeSymbol symbol)
            {
                symbolMap[declaration.Declaration] = symbol;
            }
        }

        foreach (var declaration in declarations)
        {
            if (!stageTwoCandidates.Contains(declaration))
            {
                output.Add(CreateUsedByStageOne(declaration, stageOne[declaration]));
                continue;
            }

            if (!symbolMap.TryGetValue(declaration.Declaration, out var candidateSymbol))
            {
                output.Add(CreateUnknownUsage(declaration, stageOne[declaration]));
                continue;
            }

            var analysis = AnalyzeCandidateWithSemantics(
                declaration,
                candidateSymbol,
                files,
                semanticModels,
                nodesByName,
                invocations);

            output.Add(analysis);
        }

        return output;
    }

    private static IReadOnlyList<TypeDeclarationCandidate> CollectTargetDeclarations(WorkspaceFileState targetFile)
    {
        var output = new List<TypeDeclarationCandidate>();

        foreach (var declaration in targetFile.Root.DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (declaration is not ClassDeclarationSyntax && declaration is not InterfaceDeclarationSyntax)
            {
                continue;
            }

            var identifier = declaration.Identifier.ValueText;
            if (string.IsNullOrWhiteSpace(identifier))
            {
                continue;
            }

            var position = declaration.SyntaxTree.GetLineSpan(declaration.Identifier.Span).StartLinePosition;
            output.Add(new TypeDeclarationCandidate
            {
                Declaration = declaration,
                Name = identifier,
                Kind = declaration is InterfaceDeclarationSyntax ? ConventionTypeKind.Interface : ConventionTypeKind.Class,
                RelativePath = targetFile.RelativePath,
                Namespace = ResolveNamespace(declaration),
                Line = position.Line,
                Column = position.Character,
            });
        }

        return output;
    }

    private static string? ResolveNamespace(SyntaxNode declaration)
    {
        var namespaceNode = declaration.Ancestors()
            .OfType<BaseNamespaceDeclarationSyntax>()
            .FirstOrDefault();
        return namespaceNode?.Name.ToString();
    }

    private static Dictionary<TypeDeclarationCandidate, StageOneEvidence> RunStageOnePrefilter(
        IReadOnlyList<WorkspaceFileState> files,
        WorkspaceFileState targetFile,
        IReadOnlyList<TypeDeclarationCandidate> candidates)
    {
        var output = candidates.ToDictionary(item => item, _ => new StageOneEvidence());

        foreach (var file in files)
        {
            var lines = SplitLines(file.Content);
            for (var lineIndex = 0; lineIndex < lines.Count; lineIndex++)
            {
                var line = lines[lineIndex];
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                foreach (var candidate in candidates)
                {
                    if (!ContainsIdentifierToken(line, candidate.Name))
                    {
                        continue;
                    }

                    if (IsLikelyTypeDeclarationLine(line, candidate.Name))
                    {
                        continue;
                    }

                    if (string.Equals(file.NormalizedPath, targetFile.NormalizedPath, StringComparison.Ordinal) &&
                        candidate.Line == lineIndex)
                    {
                        continue;
                    }

                    var evidence = output[candidate];
                    if (IsLikelyDependencyInjectionRegistrationLine(line))
                    {
                        evidence.DependencyInjectionMentions++;
                        continue;
                    }

                    if (file.IsTestFile)
                    {
                        evidence.TestMentions++;
                    }
                    else
                    {
                        evidence.ProductionMentions++;
                    }
                }
            }
        }

        return output;
    }

    private static IReadOnlyDictionary<string, List<NodeEntry>> IndexSimpleNameNodes(IReadOnlyList<WorkspaceFileState> files)
    {
        var output = new Dictionary<string, List<NodeEntry>>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            foreach (var node in file.Root.DescendantNodes().OfType<SimpleNameSyntax>())
            {
                var key = node.Identifier.ValueText;
                if (string.IsNullOrWhiteSpace(key))
                {
                    continue;
                }

                if (!output.TryGetValue(key, out var list))
                {
                    list = new List<NodeEntry>();
                    output[key] = list;
                }

                list.Add(new NodeEntry
                {
                    File = file,
                    Node = node,
                });
            }
        }

        return output;
    }

    private static TypeUsageFacts AnalyzeCandidateWithSemantics(
        TypeDeclarationCandidate declaration,
        INamedTypeSymbol candidateSymbol,
        IReadOnlyList<WorkspaceFileState> files,
        IReadOnlyDictionary<string, SemanticModel> semanticModels,
        IReadOnlyDictionary<string, List<NodeEntry>> nodesByName,
        IReadOnlyDictionary<string, List<InvocationExpressionSyntax>> invocations)
    {
        var accumulator = new UsageAccumulator(declaration, candidateSymbol);
        var fullyQualifiedName = BuildCandidateNameSet(candidateSymbol, declaration.Name);

        if (nodesByName.TryGetValue(declaration.Name, out var nodes))
        {
            foreach (var nodeEntry in nodes)
            {
                if (nodeEntry.Node.Parent is TypeDeclarationSyntax typeDeclaration &&
                    string.Equals(typeDeclaration.Identifier.ValueText, declaration.Name, StringComparison.Ordinal))
                {
                    continue;
                }

                if (!semanticModels.TryGetValue(nodeEntry.File.NormalizedPath, out var model))
                {
                    continue;
                }

                if (IsInsideNameofExpression(nodeEntry.Node))
                {
                    RegisterSemanticTypeReference(accumulator, nodeEntry.File, nodeEntry.Node, model, candidateSymbol, isReflection: true);
                    continue;
                }

                RegisterSemanticTypeReference(accumulator, nodeEntry.File, nodeEntry.Node, model, candidateSymbol, isReflection: IsReflectionContext(nodeEntry.Node));
            }
        }

        foreach (var file in files)
        {
            if (!semanticModels.TryGetValue(file.NormalizedPath, out var model) ||
                !invocations.TryGetValue(file.NormalizedPath, out var fileInvocations))
            {
                continue;
            }

            foreach (var invocation in fileInvocations)
            {
                if (MatchesObjectGetType(invocation, model, candidateSymbol))
                {
                    accumulator.Record(file, invocation, ConventionTypeUsageOrigin.Reflection, isDependencyInjectionRegistration: false);
                    continue;
                }

                if (TryExtractReflectionTypeName(invocation, model, out var literalTypeNames))
                {
                    foreach (var literal in literalTypeNames)
                    {
                        if (MatchesTypeNameLiteral(literal, fullyQualifiedName))
                        {
                            accumulator.Record(file, invocation, ConventionTypeUsageOrigin.Reflection, isDependencyInjectionRegistration: false);
                            break;
                        }
                    }
                }
            }
        }

        return accumulator.ToFacts();
    }

    private static void RegisterSemanticTypeReference(
        UsageAccumulator accumulator,
        WorkspaceFileState file,
        SimpleNameSyntax node,
        SemanticModel semanticModel,
        INamedTypeSymbol candidateSymbol,
        bool isReflection)
    {
        var isDependencyInjectionRegistration = IsDependencyInjectionRegistrationNode(node, semanticModel);
        var symbol = ResolveNodeTypeSymbol(node, semanticModel);

        if (symbol != null)
        {
            if (IsMatchingTypeSymbol(symbol, candidateSymbol))
            {
                accumulator.Record(file, node, isReflection ? ConventionTypeUsageOrigin.Reflection : ConventionTypeUsageOrigin.Production, isDependencyInjectionRegistration);
            }

            return;
        }

        if (isDependencyInjectionRegistration)
        {
            accumulator.Record(file, node, ConventionTypeUsageOrigin.DependencyInjectionRegistration, isDependencyInjectionRegistration: true);
            return;
        }

        if (LooksLikeTypeReference(node))
        {
            accumulator.Record(file, node, ConventionTypeUsageOrigin.Unknown, isDependencyInjectionRegistration: false);
        }
    }

    private static ISet<string> BuildCandidateNameSet(INamedTypeSymbol symbol, string fallbackName)
    {
        var output = new HashSet<string>(StringComparer.Ordinal);

        output.Add(fallbackName);
        output.Add(symbol.Name);

        var displayName = symbol.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat);
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            output.Add(displayName);
        }

        var fullyQualified = symbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)
            .Replace("global::", string.Empty);
        if (!string.IsNullOrWhiteSpace(fullyQualified))
        {
            output.Add(fullyQualified);
        }

        var namespaceDisplay = symbol.ContainingNamespace?.ToDisplayString();
        if (!string.IsNullOrWhiteSpace(namespaceDisplay))
        {
            output.Add($"{namespaceDisplay}.{symbol.Name}");
        }

        return output;
    }

    private static INamedTypeSymbol? ResolveNodeTypeSymbol(SimpleNameSyntax node, SemanticModel semanticModel)
    {
        var symbolInfo = semanticModel.GetSymbolInfo(node);
        var direct = NormalizeNamedType(symbolInfo.Symbol);
        if (direct != null)
        {
            return direct;
        }

        foreach (var candidate in symbolInfo.CandidateSymbols)
        {
            var normalized = NormalizeNamedType(candidate);
            if (normalized != null)
            {
                return normalized;
            }
        }

        var typeInfo = semanticModel.GetTypeInfo(node);
        return NormalizeNamedType(typeInfo.Type);
    }

    private static INamedTypeSymbol? NormalizeNamedType(ISymbol? symbol)
    {
        if (symbol == null)
        {
            return null;
        }

        if (symbol is IAliasSymbol alias)
        {
            return NormalizeNamedType(alias.Target);
        }

        if (symbol is INamedTypeSymbol named)
        {
            return named;
        }

        if (symbol is ITypeSymbol typeSymbol && typeSymbol is INamedTypeSymbol typeNamed)
        {
            return typeNamed;
        }

        return null;
    }

    private static bool IsMatchingTypeSymbol(INamedTypeSymbol observed, INamedTypeSymbol candidate)
    {
        if (SymbolEqualityComparer.Default.Equals(observed, candidate))
        {
            return true;
        }

        return SymbolEqualityComparer.Default.Equals(observed.OriginalDefinition, candidate.OriginalDefinition);
    }

    private static bool MatchesObjectGetType(InvocationExpressionSyntax invocation, SemanticModel semanticModel, INamedTypeSymbol candidate)
    {
        if (invocation.ArgumentList.Arguments.Count != 0)
        {
            return false;
        }

        if (invocation.Expression is not MemberAccessExpressionSyntax memberAccess ||
            !string.Equals(memberAccess.Name.Identifier.ValueText, "GetType", StringComparison.Ordinal))
        {
            return false;
        }

        var symbol = semanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
        if (symbol != null && !string.Equals(symbol.Name, "GetType", StringComparison.Ordinal))
        {
            return false;
        }

        var receiverType = semanticModel.GetTypeInfo(memberAccess.Expression).Type as INamedTypeSymbol;
        if (receiverType == null)
        {
            return false;
        }

        return IsMatchingTypeSymbol(receiverType, candidate);
    }

    private static bool TryExtractReflectionTypeName(
        InvocationExpressionSyntax invocation,
        SemanticModel semanticModel,
        out IReadOnlyList<string> typeNames)
    {
        var output = new List<string>();
        typeNames = output;

        if (!IsReflectionApiInvocation(invocation, semanticModel, out var kind))
        {
            return false;
        }

        var args = invocation.ArgumentList.Arguments;
        if (args.Count == 0)
        {
            return false;
        }

        if (kind == ReflectionInvocationKind.ActivatorCreateInstance)
        {
            foreach (var argument in args)
            {
                if (argument.Expression is TypeOfExpressionSyntax typeOfExpression)
                {
                    output.Add(typeOfExpression.Type.ToString());
                    continue;
                }

                var literal = ExtractStringLiteral(argument.Expression);
                if (!string.IsNullOrWhiteSpace(literal))
                {
                    output.Add(literal!);
                }
            }

            return output.Count > 0;
        }

        foreach (var argument in args)
        {
            var literal = ExtractStringLiteral(argument.Expression);
            if (!string.IsNullOrWhiteSpace(literal))
            {
                output.Add(literal!);
            }
        }

        return output.Count > 0;
    }

    private static bool IsReflectionApiInvocation(
        InvocationExpressionSyntax invocation,
        SemanticModel semanticModel,
        out ReflectionInvocationKind kind)
    {
        kind = ReflectionInvocationKind.None;

        var symbol = semanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
        if (symbol != null)
        {
            if (string.Equals(symbol.Name, "GetType", StringComparison.Ordinal) &&
                string.Equals(symbol.ContainingType?.ToDisplayString(), "System.Type", StringComparison.Ordinal))
            {
                kind = ReflectionInvocationKind.TypeGetType;
                return true;
            }

            if (string.Equals(symbol.Name, "GetType", StringComparison.Ordinal) &&
                string.Equals(symbol.ContainingType?.ToDisplayString(), "System.Reflection.Assembly", StringComparison.Ordinal))
            {
                kind = ReflectionInvocationKind.AssemblyGetType;
                return true;
            }

            if (string.Equals(symbol.Name, "CreateInstance", StringComparison.Ordinal) &&
                string.Equals(symbol.ContainingType?.ToDisplayString(), "System.Activator", StringComparison.Ordinal))
            {
                kind = ReflectionInvocationKind.ActivatorCreateInstance;
                return true;
            }
        }

        var invokedName = invocation.Expression switch
        {
            MemberAccessExpressionSyntax memberAccess => memberAccess.Name.Identifier.ValueText,
            IdentifierNameSyntax identifierName => identifierName.Identifier.ValueText,
            _ => string.Empty,
        };

        if (string.IsNullOrWhiteSpace(invokedName))
        {
            return false;
        }

        if (string.Equals(invokedName, "GetType", StringComparison.Ordinal) &&
            invocation.Expression.ToString().IndexOf("Type", StringComparison.Ordinal) >= 0)
        {
            kind = ReflectionInvocationKind.TypeGetType;
            return true;
        }

        if (string.Equals(invokedName, "GetType", StringComparison.Ordinal) &&
            invocation.Expression.ToString().IndexOf("Assembly", StringComparison.Ordinal) >= 0)
        {
            kind = ReflectionInvocationKind.AssemblyGetType;
            return true;
        }

        if (string.Equals(invokedName, "CreateInstance", StringComparison.Ordinal) &&
            invocation.Expression.ToString().IndexOf("Activator", StringComparison.Ordinal) >= 0)
        {
            kind = ReflectionInvocationKind.ActivatorCreateInstance;
            return true;
        }

        return false;
    }

    private static string? ExtractStringLiteral(ExpressionSyntax expression)
    {
        if (expression is LiteralExpressionSyntax literal &&
            literal.IsKind(SyntaxKind.StringLiteralExpression))
        {
            return literal.Token.ValueText;
        }

        return null;
    }

    private static bool MatchesTypeNameLiteral(string literal, ISet<string> candidates)
    {
        if (string.IsNullOrWhiteSpace(literal))
        {
            return false;
        }

        var trimmed = literal.Trim();
        if (trimmed.Length == 0)
        {
            return false;
        }

        var withoutAssembly = trimmed.Split(',')[0].Trim();
        if (candidates.Contains(withoutAssembly) || candidates.Contains(trimmed))
        {
            return true;
        }

        foreach (Match match in TypeNameLiteralRegex.Matches(trimmed))
        {
            if (candidates.Contains(match.Value))
            {
                return true;
            }

            var lastSegment = match.Value.Split('.').LastOrDefault();
            if (!string.IsNullOrWhiteSpace(lastSegment) && candidates.Contains(lastSegment))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsReflectionContext(SyntaxNode node)
    {
        if (node.Ancestors().OfType<TypeOfExpressionSyntax>().Any() ||
            IsInsideNameofExpression(node))
        {
            return true;
        }

        return node.Parent is TypeOfExpressionSyntax || IsInsideNameofExpression(node.Parent);
    }

    private static bool IsInsideNameofExpression(SyntaxNode? node)
    {
        if (node == null)
        {
            return false;
        }

        return node.AncestorsAndSelf()
            .OfType<InvocationExpressionSyntax>()
            .Any(invocation =>
            {
                if (invocation.Expression is IdentifierNameSyntax identifierName)
                {
                    return string.Equals(identifierName.Identifier.ValueText, "nameof", StringComparison.Ordinal);
                }

                return false;
            });
    }

    private static bool LooksLikeTypeReference(SimpleNameSyntax node)
    {
        return node.Parent switch
        {
            QualifiedNameSyntax => true,
            GenericNameSyntax => true,
            TypeArgumentListSyntax => true,
            BaseTypeSyntax => true,
            VariableDeclarationSyntax => true,
            ParameterSyntax => true,
            ObjectCreationExpressionSyntax => true,
            TypeOfExpressionSyntax => true,
            CastExpressionSyntax => true,
            _ => node.Ancestors().Any(ancestor => ancestor is TypeSyntax),
        };
    }

    private static bool IsDependencyInjectionRegistrationNode(SimpleNameSyntax node, SemanticModel semanticModel)
    {
        if (node.Ancestors().OfType<InvocationExpressionSyntax>().FirstOrDefault() is not { } invocation)
        {
            return false;
        }

        if (invocation.Expression is MemberAccessExpressionSyntax memberAccess &&
            DiRegistrationMethods.Contains(memberAccess.Name.Identifier.ValueText))
        {
            return true;
        }

        if (invocation.Expression is IdentifierNameSyntax identifier &&
            DiRegistrationMethods.Contains(identifier.Identifier.ValueText))
        {
            return true;
        }

        var methodSymbol = semanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
        if (methodSymbol == null)
        {
            return false;
        }

        return DiRegistrationMethods.Contains(methodSymbol.Name);
    }

    private static bool IsLikelyDependencyInjectionRegistrationLine(string line)
    {
        return line.IndexOf("AddScoped", StringComparison.Ordinal) >= 0 ||
               line.IndexOf("AddTransient", StringComparison.Ordinal) >= 0 ||
               line.IndexOf("AddSingleton", StringComparison.Ordinal) >= 0;
    }

    private static bool IsLikelyTypeDeclarationLine(string line, string typeName)
    {
        return Regex.IsMatch(
            line,
            $@"\b(class|interface|record|struct|enum)\s+{Regex.Escape(typeName)}\b",
            RegexOptions.CultureInvariant);
    }

    private static bool ContainsIdentifierToken(string line, string token)
    {
        return Regex.IsMatch(line, $@"\b{Regex.Escape(token)}\b", RegexOptions.CultureInvariant);
    }

    private static IReadOnlyList<string> SplitLines(string content)
    {
        if (content.Length == 0)
        {
            return Array.Empty<string>();
        }

        return content.Replace("\r\n", "\n").Split('\n');
    }

    private static string NormalizePath(string path)
    {
        return Path.GetFullPath(path)
            .Replace('\\', '/')
            .TrimEnd('/');
    }

    private List<WorkspaceFileState> BuildWorkspaceFileStates(
        string workspaceRoot,
        string targetFilePath,
        string targetFileContent,
        ProjectConventionOptions options)
    {
        var csOptions = options.Clone();
        csOptions.SupportedExtensions = new List<string> { "cs" };

        var filePaths = _workspaceFileProvider
            .EnumerateFiles(workspaceRoot, csOptions)
            .Where(path => string.Equals(Path.GetExtension(path), ".cs", StringComparison.OrdinalIgnoreCase))
            .Select(path => Path.GetFullPath(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var normalizedTarget = NormalizePath(targetFilePath);
        if (!filePaths.Any(path => string.Equals(NormalizePath(path), normalizedTarget, StringComparison.Ordinal)))
        {
            filePaths.Add(Path.GetFullPath(targetFilePath));
        }

        var output = new List<WorkspaceFileState>();
        foreach (var fullPath in filePaths)
        {
            string? content = null;
            if (string.Equals(NormalizePath(fullPath), normalizedTarget, StringComparison.Ordinal))
            {
                content = targetFileContent;
            }
            else
            {
                _textFileReader.TryRead(fullPath, out content);
            }

            if (content == null)
            {
                continue;
            }

            var facts = _symbolExtractor.Extract(workspaceRoot, fullPath, content);
            if (!string.Equals(facts.Extension, "cs", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var tree = CSharpSyntaxTree.ParseText(content, path: fullPath);
            var root = tree.GetRoot();
            output.Add(new WorkspaceFileState
            {
                FullPath = fullPath,
                NormalizedPath = NormalizePath(fullPath),
                RelativePath = facts.RelativePath,
                Content = content,
                Tree = tree,
                Root = root,
                IsTestFile = IsTestFile(facts, fullPath),
            });
        }

        return output;
    }

    private static bool IsTestFile(ProjectFileFacts facts, string fullPath)
    {
        if (facts.IsTestProjectFile)
        {
            return true;
        }

        var normalized = fullPath.Replace('\\', '/');
        if (normalized.IndexOf(".Tests/", StringComparison.OrdinalIgnoreCase) >= 0 ||
            normalized.IndexOf("/Tests/", StringComparison.OrdinalIgnoreCase) >= 0 ||
            normalized.IndexOf("/Test/", StringComparison.OrdinalIgnoreCase) >= 0 ||
            normalized.IndexOf("/Specs/", StringComparison.OrdinalIgnoreCase) >= 0 ||
            normalized.IndexOf("/Spec/", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return true;
        }

        var fileName = Path.GetFileNameWithoutExtension(fullPath);
        return fileName.EndsWith("Tests", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith("Test", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith("Specs", StringComparison.OrdinalIgnoreCase) ||
               fileName.EndsWith("Spec", StringComparison.OrdinalIgnoreCase);
    }

    private static TypeUsageFacts CreateUsedByStageOne(TypeDeclarationCandidate declaration, StageOneEvidence evidence)
    {
        var origins = new List<ConventionTypeUsageOrigin>();
        if (evidence.ProductionMentions > 0)
        {
            origins.Add(ConventionTypeUsageOrigin.Production);
        }

        if (evidence.TestMentions > 0)
        {
            origins.Add(ConventionTypeUsageOrigin.Test);
        }

        if (evidence.DependencyInjectionMentions > 0)
        {
            origins.Add(ConventionTypeUsageOrigin.DependencyInjectionRegistration);
        }

        if (origins.Count == 0)
        {
            origins.Add(ConventionTypeUsageOrigin.Unknown);
        }

        return new TypeUsageFacts
        {
            TypeName = declaration.Name,
            TypeKind = declaration.Kind,
            FilePath = declaration.RelativePath,
            Line = declaration.Line,
            Column = declaration.Column,
            Namespace = declaration.Namespace,
            FullyQualifiedName = string.IsNullOrWhiteSpace(declaration.Namespace)
                ? declaration.Name
                : $"{declaration.Namespace}.{declaration.Name}",
            Classification = ConventionTypeUsageClassification.UsedInProduction,
            ProductionReferenceCount = Math.Max(1, evidence.ProductionMentions),
            TestReferenceCount = evidence.TestMentions,
            DependencyInjectionRegistrationCount = evidence.DependencyInjectionMentions,
            Origins = origins,
        };
    }

    private static TypeUsageFacts CreateUnknownUsage(TypeDeclarationCandidate declaration, StageOneEvidence evidence)
    {
        var hasHeuristicUsageSignal =
            evidence.ProductionMentions > 0 ||
            evidence.TestMentions > 0 ||
            evidence.DependencyInjectionMentions > 0;

        var classification = hasHeuristicUsageSignal
            ? ConventionTypeUsageClassification.Unknown
            : ConventionTypeUsageClassification.Unused;

        var origins = new List<ConventionTypeUsageOrigin>();
        if (hasHeuristicUsageSignal)
        {
            origins.Add(ConventionTypeUsageOrigin.Unknown);
        }

        return new TypeUsageFacts
        {
            TypeName = declaration.Name,
            TypeKind = declaration.Kind,
            FilePath = declaration.RelativePath,
            Line = declaration.Line,
            Column = declaration.Column,
            Namespace = declaration.Namespace,
            FullyQualifiedName = string.IsNullOrWhiteSpace(declaration.Namespace)
                ? declaration.Name
                : $"{declaration.Namespace}.{declaration.Name}",
            Classification = classification,
            ProductionReferenceCount = evidence.ProductionMentions,
            TestReferenceCount = evidence.TestMentions,
            DependencyInjectionRegistrationCount = evidence.DependencyInjectionMentions,
            UnknownReferenceCount = hasHeuristicUsageSignal
                ? evidence.ProductionMentions + evidence.TestMentions
                : 0,
            Origins = origins,
        };
    }

    private static MetadataReference[] BuildMetadataReferences()
    {
        var output = new List<MetadataReference>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        static void AddReference(Assembly assembly, ICollection<MetadataReference> references, ISet<string> seenSet)
        {
            if (assembly.IsDynamic)
            {
                return;
            }

            var location = assembly.Location;
            if (string.IsNullOrWhiteSpace(location) || !File.Exists(location) || !seenSet.Add(location))
            {
                return;
            }

            references.Add(MetadataReference.CreateFromFile(location));
        }

        AddReference(typeof(object).Assembly, output, seen);
        AddReference(typeof(Enumerable).Assembly, output, seen);
        AddReference(typeof(List<>).Assembly, output, seen);
        AddReference(typeof(System.Runtime.GCSettings).Assembly, output, seen);
        AddReference(typeof(Regex).Assembly, output, seen);

        var tpaRaw = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string;
        if (!string.IsNullOrWhiteSpace(tpaRaw))
        {
            var tpa = tpaRaw!;
            foreach (var path in tpa.Split(Path.PathSeparator))
            {
                if (!File.Exists(path) || !seen.Add(path))
                {
                    continue;
                }

                output.Add(MetadataReference.CreateFromFile(path));
            }
        }

        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            AddReference(assembly, output, seen);
        }

        return output.ToArray();
    }

    private sealed class WorkspaceFileState
    {
        public string FullPath { get; set; } = string.Empty;

        public string NormalizedPath { get; set; } = string.Empty;

        public string RelativePath { get; set; } = string.Empty;

        public string Content { get; set; } = string.Empty;

        public SyntaxTree Tree { get; set; } = null!;

        public SyntaxNode Root { get; set; } = null!;

        public bool IsTestFile { get; set; }
    }

    private sealed class TypeDeclarationCandidate
    {
        public TypeDeclarationSyntax Declaration { get; set; } = null!;

        public string Name { get; set; } = string.Empty;

        public ConventionTypeKind Kind { get; set; }

        public string RelativePath { get; set; } = string.Empty;

        public string? Namespace { get; set; }

        public int Line { get; set; }

        public int Column { get; set; }
    }

    private sealed class StageOneEvidence
    {
        public int ProductionMentions { get; set; }

        public int TestMentions { get; set; }

        public int DependencyInjectionMentions { get; set; }

        public bool HasStrongProductionSignal => ProductionMentions >= 2;
    }

    private sealed class NodeEntry
    {
        public WorkspaceFileState File { get; set; } = null!;

        public SimpleNameSyntax Node { get; set; } = null!;
    }

    private sealed class UsageAccumulator
    {
        private readonly TypeDeclarationCandidate _declaration;
        private readonly INamedTypeSymbol _symbol;
        private readonly List<TypeUsageEvidence> _evidence = new();
        private readonly HashSet<string> _dedupe = new(StringComparer.Ordinal);
        private readonly HashSet<ConventionTypeUsageOrigin> _origins = new();

        private int _production;
        private int _test;
        private int _reflection;
        private int _unknown;
        private int _di;

        public UsageAccumulator(TypeDeclarationCandidate declaration, INamedTypeSymbol symbol)
        {
            _declaration = declaration;
            _symbol = symbol;
        }

        public void Record(
            WorkspaceFileState file,
            SyntaxNode node,
            ConventionTypeUsageOrigin origin,
            bool isDependencyInjectionRegistration)
        {
            var location = node.GetLocation().GetLineSpan().StartLinePosition;
            var key = $"{file.RelativePath}|{location.Line}|{location.Character}|{origin}|{isDependencyInjectionRegistration}";
            if (!_dedupe.Add(key))
            {
                return;
            }

            var effectiveOrigin = origin;
            if (isDependencyInjectionRegistration)
            {
                effectiveOrigin = ConventionTypeUsageOrigin.DependencyInjectionRegistration;
                _di++;
            }
            else if (origin == ConventionTypeUsageOrigin.Unknown)
            {
                _unknown++;
            }
            else
            {
                if (file.IsTestFile)
                {
                    _test++;
                    _origins.Add(ConventionTypeUsageOrigin.Test);
                }
                else
                {
                    _production++;
                    _origins.Add(ConventionTypeUsageOrigin.Production);
                }

                if (origin == ConventionTypeUsageOrigin.Reflection)
                {
                    _reflection++;
                    _origins.Add(ConventionTypeUsageOrigin.Reflection);
                }
            }

            _origins.Add(effectiveOrigin);

            _evidence.Add(new TypeUsageEvidence
            {
                FilePath = file.RelativePath,
                Line = location.Line,
                Column = location.Character,
                MemberName = ResolveMemberName(node),
                Origin = effectiveOrigin,
                IsTestFile = file.IsTestFile,
                IsDependencyInjectionRegistration = isDependencyInjectionRegistration,
            });
        }

        public TypeUsageFacts ToFacts()
        {
            var classification = ResolveClassification();

            return new TypeUsageFacts
            {
                TypeName = _declaration.Name,
                TypeKind = _declaration.Kind,
                FilePath = _declaration.RelativePath,
                Line = _declaration.Line,
                Column = _declaration.Column,
                Namespace = _declaration.Namespace,
                FullyQualifiedName = _symbol.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat),
                Classification = classification,
                ProductionReferenceCount = _production,
                TestReferenceCount = _test,
                ReflectionReferenceCount = _reflection,
                UnknownReferenceCount = _unknown,
                DependencyInjectionRegistrationCount = _di,
                Origins = _origins.ToList(),
                Evidence = _evidence,
            };
        }

        private ConventionTypeUsageClassification ResolveClassification()
        {
            if (_production > 0)
            {
                return ConventionTypeUsageClassification.UsedInProduction;
            }

            if (_test > 0)
            {
                return ConventionTypeUsageClassification.UsedOnlyInTests;
            }

            if (_unknown > 0)
            {
                return ConventionTypeUsageClassification.Unknown;
            }

            return ConventionTypeUsageClassification.Unused;
        }

        private static string? ResolveMemberName(SyntaxNode node)
        {
            if (node.AncestorsAndSelf().OfType<MethodDeclarationSyntax>().FirstOrDefault() is { } method)
            {
                return method.Identifier.ValueText;
            }

            if (node.AncestorsAndSelf().OfType<ConstructorDeclarationSyntax>().FirstOrDefault() is { } ctor)
            {
                return ctor.Identifier.ValueText;
            }

            if (node.AncestorsAndSelf().OfType<LocalFunctionStatementSyntax>().FirstOrDefault() is { } localFunction)
            {
                return localFunction.Identifier.ValueText;
            }

            if (node.AncestorsAndSelf().OfType<PropertyDeclarationSyntax>().FirstOrDefault() is { } property)
            {
                return property.Identifier.ValueText;
            }

            return null;
        }
    }

    private enum ReflectionInvocationKind
    {
        None,
        TypeGetType,
        AssemblyGetType,
        ActivatorCreateInstance,
    }
}
