using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Services;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class ProjectConventionTests
{
    [Fact]
    public void Analyzer_detects_folder_suffix_mismatch()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Services/CustomerService.cs", "namespace App.Services; public class CustomerService {}");
            WriteFile(root, "Services/OrderService.cs", "namespace App.Services; public class OrderService {}");
            WriteFile(root, "Dtos/CustomerDto.cs", "namespace App.Dtos; public class CustomerDto {}");

            var service = new ProjectConventionService();
            var build = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    EnableProjectConventionMapping = true,
                    EnableNamingConventionDiagnostics = true,
                    MaxFiles = 100,
                    MinEvidenceCount = 2,
                },
                PersistArtifacts = false,
            });

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Services", "CustomerHandler.cs"),
                FileContent = "namespace App.Services; public class CustomerHandler {}",
                Profile = build.Profile,
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 2,
                    EnableStatisticalAnomalyDetection = true,
                },
                IgnoreList = new ConventionIgnoreList(),
            });

            var ruleIds = analysis.Analysis.Diagnostics.Select(d => d.RuleId).ToList();
            Assert.Contains("KS_CONV_001", ruleIds);
            Assert.Contains("KS_CONV_008", ruleIds);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_detects_viewmodel_suffix_mismatch_with_default_min_evidence()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "ViewModels/CustomerViewModel.cs", "namespace App.ViewModels; public class CustomerViewModel {}");
            WriteFile(root, "ViewModels/OrderViewModel.cs", "namespace App.ViewModels; public class OrderViewModel {}");
            WriteFile(root, "Services/CustomerService.cs", "namespace App.Services; public class CustomerService {}");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    EnableProjectConventionMapping = true,
                    EnableNamingConventionDiagnostics = true,
                    MaxFiles = 100,
                    // intentionally left at default MinEvidenceCount=6
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "ViewModels", "PeopleModel.cs"),
                FileContent = "namespace App.ViewModels; public class PeopleModel {}",
                Profile = profile,
                Options = new ProjectConventionOptions
                {
                    EnableProjectConventionMapping = true,
                    EnableNamingConventionDiagnostics = true,
                    // intentionally left at default MinEvidenceCount=6
                },
                IgnoreList = new ConventionIgnoreList(),
            });

            var ruleIds = analysis.Analysis.Diagnostics.Select(d => d.RuleId).ToList();
            Assert.Contains("KS_CONV_001", ruleIds);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_reports_diagnostic_position_on_type_name_token()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "ViewModels/CustomerViewModel.cs", "namespace App.ViewModels; public class CustomerViewModel {}");
            WriteFile(root, "ViewModels/OrderViewModel.cs", "namespace App.ViewModels; public class OrderViewModel {}");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    EnableProjectConventionMapping = true,
                    EnableNamingConventionDiagnostics = true,
                    MaxFiles = 100,
                },
                PersistArtifacts = false,
            }).Profile;

            var content =
                "namespace App.ViewModels;\n" +
                "public sealed partial class PeopleModel\n" +
                "{\n" +
                "}\n";
            var classLine = "public sealed partial class PeopleModel";
            var expectedColumn = classLine.IndexOf("PeopleModel", StringComparison.Ordinal);

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "ViewModels", "PeopleModel.cs"),
                FileContent = content,
                Profile = profile,
                Options = new ProjectConventionOptions
                {
                    EnableProjectConventionMapping = true,
                    EnableNamingConventionDiagnostics = true,
                },
                IgnoreList = new ConventionIgnoreList(),
            });

            var mismatch = analysis.Analysis.Diagnostics.First(d => d.RuleId == "KS_CONV_001");
            Assert.Equal(1, mismatch.Line);
            Assert.Equal(expectedColumn, mismatch.Column);
            Assert.Equal(ConventionSeverity.Warning, mismatch.Severity);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_detects_file_primary_type_mismatch()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Dtos/CustomerDto.cs", "namespace App.Dtos; public class CustomerDto {}");
            WriteFile(root, "Dtos/OrderDto.cs", "namespace App.Dtos; public class OrderDto {}");
            WriteFile(root, "Dtos/InvoiceDto.cs", "namespace App.Dtos; public class InvoiceDto {}");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 2,
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Dtos", "CustomerData.cs"),
                FileContent = "namespace App.Dtos; public class CustomerDto {}",
                Profile = profile,
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 2,
                    EnableStatisticalAnomalyDetection = true,
                    EnableAiNamingAnomalyDetection = true,
                    AiAnomalyThreshold = 0.0,
                    StatisticalAnomalyThreshold = 0.1,
                },
                IgnoreList = new ConventionIgnoreList(),
            });

            var ruleIds = analysis.Analysis.Diagnostics.Select(d => d.RuleId).ToList();
            Assert.Contains("KS_CONV_003", ruleIds);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_respects_ignore_rules()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Interfaces/ICustomerService.cs", "namespace App.Interfaces; public interface ICustomerService {}");
            WriteFile(root, "Interfaces/IOrderService.cs", "namespace App.Interfaces; public interface IOrderService {}");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
                PersistArtifacts = false,
            }).Profile;

            profile.InterfaceConvention.TotalCount = 5;
            profile.InterfaceConvention.PrefixedCount = 5;
            profile.InterfaceConvention.Confidence = 1.0;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Interfaces", "CustomerService.cs"),
                FileContent = "namespace App.Interfaces; public interface CustomerService {}",
                Profile = profile,
                IgnoreList = new ConventionIgnoreList
                {
                    Entries = new List<ConventionIgnoreEntry>
                    {
                        new()
                        {
                            RuleId = "KS_CONV_004",
                            Scope = "file",
                            Target = "Interfaces/CustomerService.cs",
                        },
                    },
                },
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
            });

            Assert.DoesNotContain(analysis.Analysis.Diagnostics, d => d.RuleId == "KS_CONV_004");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_reports_KO_SPC_UNUSED_100_when_type_has_no_real_usage()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Domain/OrphanType.cs", "namespace App.Domain; public sealed class OrphanType {}");
            WriteFile(root, "Domain/OtherType.cs", "namespace App.Domain; public sealed class OtherType {}");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Domain", "OrphanType.cs"),
                FileContent = "namespace App.Domain; public sealed class OrphanType {}",
                Profile = profile,
                IgnoreList = new ConventionIgnoreList(),
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                    EnableStatisticalAnomalyDetection = false,
                    EnableAiNamingAnomalyDetection = false,
                },
            });

            var unused = Assert.Single(analysis.Analysis.Diagnostics, d => d.RuleId == "KO_SPC_UNUSED_100");
            Assert.Equal(ConventionSeverity.Warning, unused.Severity);
            Assert.DoesNotContain(analysis.Analysis.Diagnostics, d => d.RuleId == "KO_SPC_UNUSED_110");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_reports_KO_SPC_UNUSED_110_when_type_is_only_used_by_tests()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Domain/TestOnlyType.cs", "namespace App.Domain; public sealed class TestOnlyType {}");
            WriteFile(
                root,
                "Tests/TestOnlyTypeTests.cs",
                "using App.Domain; namespace App.Tests; public sealed class TestOnlyTypeTests { private readonly TestOnlyType _sut = new(); }");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Domain", "TestOnlyType.cs"),
                FileContent = "namespace App.Domain; public sealed class TestOnlyType {}",
                Profile = profile,
                IgnoreList = new ConventionIgnoreList(),
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                    EnableStatisticalAnomalyDetection = false,
                    EnableAiNamingAnomalyDetection = false,
                },
            });

            var testOnly = Assert.Single(analysis.Analysis.Diagnostics, d => d.RuleId == "KO_SPC_UNUSED_110");
            Assert.Equal(ConventionSeverity.Warning, testOnly.Severity);
            Assert.DoesNotContain(analysis.Analysis.Diagnostics, d => d.RuleId == "KO_SPC_UNUSED_100");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_recognizes_generic_interface_usage_as_used()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Contracts/IFoo.cs", "namespace App.Contracts; public interface IFoo<TItem> {}");
            WriteFile(
                root,
                "Services/GenericConsumer.cs",
                "using App.Contracts; namespace App.Services; public sealed class GenericConsumer { private readonly IFoo<GenericPayload> _foo; public GenericConsumer(IFoo<GenericPayload> foo) { _foo = foo; } } public sealed class GenericPayload {}");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Contracts", "IFoo.cs"),
                FileContent = "namespace App.Contracts; public interface IFoo<TItem> {}",
                Profile = profile,
                IgnoreList = new ConventionIgnoreList(),
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                    EnableStatisticalAnomalyDetection = false,
                    EnableAiNamingAnomalyDetection = false,
                },
            });

            Assert.DoesNotContain(analysis.Analysis.Diagnostics, d => d.RuleId is "KO_SPC_UNUSED_100" or "KO_SPC_UNUSED_110");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_does_not_count_di_registration_alone_as_usage()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(root, "Services/EmailSender.cs", "namespace App.Services; public sealed class EmailSender {}");
            WriteFile(
                root,
                "Composition/Registrations.cs",
                "namespace App.Composition; public sealed class Registrations { public void Register(object services) { services.AddTransient<App.Services.EmailSender>(); services.AddScoped<App.Services.EmailSender>(); services.AddSingleton<App.Services.EmailSender>(); } }");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Services", "EmailSender.cs"),
                FileContent = "namespace App.Services; public sealed class EmailSender {}",
                Profile = profile,
                IgnoreList = new ConventionIgnoreList(),
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                    EnableStatisticalAnomalyDetection = false,
                    EnableAiNamingAnomalyDetection = false,
                },
            });

            Assert.Contains(analysis.Analysis.Diagnostics, d => d.RuleId == "KO_SPC_UNUSED_100");
            Assert.DoesNotContain(analysis.Analysis.Diagnostics, d => d.RuleId == "KO_SPC_UNUSED_110");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Analyzer_recognizes_reflection_usage_patterns()
    {
        var root = CreateTempWorkspace();
        try
        {
            WriteFile(
                root,
                "Reflection/ReflectionTargets.cs",
                "namespace App.Reflection; public sealed class TypeOfTarget {} public sealed class NameOfTarget {} public sealed class GetTypeTarget {} public sealed class StringTypeTarget {} public sealed class AssemblyTypeTarget {} public sealed class ActivatorTarget {}");
            WriteFile(
                root,
                "Reflection/ReflectionConsumer.cs",
                "using System; using System.Reflection; namespace App.Reflection; public sealed class ReflectionConsumer { private readonly GetTypeTarget _instance = new(); public void Use(Assembly assembly) { _ = typeof(TypeOfTarget); _ = nameof(NameOfTarget); _ = _instance.GetType(); _ = Type.GetType(\"App.Reflection.StringTypeTarget\"); _ = assembly.GetType(\"App.Reflection.AssemblyTypeTarget\"); _ = Activator.CreateInstance(typeof(ActivatorTarget)); } }");

            var service = new ProjectConventionService();
            var profile = service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = root,
                Scope = "workspace",
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                },
                PersistArtifacts = false,
            }).Profile;

            var analysis = service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = root,
                FilePath = Path.Combine(root, "Reflection", "ReflectionTargets.cs"),
                FileContent = "namespace App.Reflection; public sealed class TypeOfTarget {} public sealed class NameOfTarget {} public sealed class GetTypeTarget {} public sealed class StringTypeTarget {} public sealed class AssemblyTypeTarget {} public sealed class ActivatorTarget {}",
                Profile = profile,
                IgnoreList = new ConventionIgnoreList(),
                Options = new ProjectConventionOptions
                {
                    MinEvidenceCount = 1,
                    EnableStatisticalAnomalyDetection = false,
                    EnableAiNamingAnomalyDetection = false,
                },
            });

            Assert.DoesNotContain(analysis.Analysis.Diagnostics, d => d.RuleId is "KO_SPC_UNUSED_100" or "KO_SPC_UNUSED_110");
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static string CreateTempWorkspace()
    {
        return Directory.CreateTempSubdirectory("koscore-conventions-").FullName;
    }

    private static void WriteFile(string root, string relativePath, string content)
    {
        var fullPath = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(fullPath, content);
    }
}
