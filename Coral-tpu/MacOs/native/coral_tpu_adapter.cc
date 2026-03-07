#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <dlfcn.h>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace {

struct TfLiteModel;
struct TfLiteInterpreterOptions;
struct TfLiteInterpreter;
struct TfLiteTensor;
struct TfLiteDelegate;

enum TfLiteStatus {
  kTfLiteOk = 0,
  kTfLiteError = 1
};

using TfLiteModelCreateFromFileFn = TfLiteModel* (*)(const char*);
using TfLiteModelDeleteFn = void (*)(TfLiteModel*);
using TfLiteInterpreterOptionsCreateFn = TfLiteInterpreterOptions* (*)();
using TfLiteInterpreterOptionsDeleteFn = void (*)(TfLiteInterpreterOptions*);
using TfLiteInterpreterOptionsSetNumThreadsFn = void (*)(TfLiteInterpreterOptions*, int);
using TfLiteInterpreterOptionsAddDelegateFn = void (*)(TfLiteInterpreterOptions*, TfLiteDelegate*);
using TfLiteInterpreterCreateFn = TfLiteInterpreter* (*)(const TfLiteModel*, const TfLiteInterpreterOptions*);
using TfLiteInterpreterDeleteFn = void (*)(TfLiteInterpreter*);
using TfLiteInterpreterAllocateTensorsFn = TfLiteStatus (*)(TfLiteInterpreter*);
using TfLiteInterpreterGetInputTensorFn = TfLiteTensor* (*)(TfLiteInterpreter*, int);
using TfLiteInterpreterGetOutputTensorFn = const TfLiteTensor* (*)(const TfLiteInterpreter*, int);
using TfLiteInterpreterInvokeFn = TfLiteStatus (*)(TfLiteInterpreter*);
using TfLiteTensorByteSizeFn = size_t (*)(const TfLiteTensor*);
using TfLiteTensorCopyFromBufferFn = TfLiteStatus (*)(TfLiteTensor*, const void*, size_t);
using TfLiteTensorCopyToBufferFn = TfLiteStatus (*)(const TfLiteTensor*, void*, size_t);

using EdgeTpuCreateDelegateFn = void* (*)(int, const char*, const void*, size_t);
using EdgeTpuFreeDelegateFn = void (*)(void*);

struct TfLiteApi {
  void* handle = nullptr;
  TfLiteModelCreateFromFileFn modelCreateFromFile = nullptr;
  TfLiteModelDeleteFn modelDelete = nullptr;
  TfLiteInterpreterOptionsCreateFn optionsCreate = nullptr;
  TfLiteInterpreterOptionsDeleteFn optionsDelete = nullptr;
  TfLiteInterpreterOptionsSetNumThreadsFn optionsSetNumThreads = nullptr;
  TfLiteInterpreterOptionsAddDelegateFn optionsAddDelegate = nullptr;
  TfLiteInterpreterCreateFn interpreterCreate = nullptr;
  TfLiteInterpreterDeleteFn interpreterDelete = nullptr;
  TfLiteInterpreterAllocateTensorsFn allocateTensors = nullptr;
  TfLiteInterpreterGetInputTensorFn getInputTensor = nullptr;
  TfLiteInterpreterGetOutputTensorFn getOutputTensor = nullptr;
  TfLiteInterpreterInvokeFn invoke = nullptr;
  TfLiteTensorByteSizeFn tensorByteSize = nullptr;
  TfLiteTensorCopyFromBufferFn tensorCopyFromBuffer = nullptr;
  TfLiteTensorCopyToBufferFn tensorCopyToBuffer = nullptr;
};

struct EdgeTpuApi {
  void* handle = nullptr;
  EdgeTpuCreateDelegateFn createDelegate = nullptr;
  EdgeTpuFreeDelegateFn freeDelegate = nullptr;
};

struct Profile {
  std::string id = "runtime-default";
  std::string displayName = "Runtime Default Typo Model";
  double intercept = -0.10;
  double distanceWeight = -1.08;
  double similarityWeight = 2.70;
  double identifierBoost = 0.23;
  double literalBoost = 0.06;
  double longTokenBoost = 0.08;
  double shortTokenPenalty = -0.10;
  double typoThreshold = 0.62;
  double notTypoThreshold = 0.34;
};

struct ClassifierRequest {
  std::string token;
  std::string topSuggestion;
  std::string context = "identifier";
  std::string modelPath;
  std::string modelId = "auto";
};

struct ClassificationResult {
  bool isTypo = false;
  double confidence = 0.5;
  std::string category = "Uncertain";
  std::string backend = "coral-native-heuristic";
  std::string reason;
};

struct AdapterState {
  TfLiteApi tfLite;
  EdgeTpuApi edgeTpu;
  bool tpuDelegateReady = false;
  std::string detail;
};

double clamp(const double value, const double min, const double max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

std::string readAllStdin() {
  std::ostringstream out;
  out << std::cin.rdbuf();
  return out.str();
}

std::optional<std::string> readFile(const std::string& filePath) {
  std::ifstream in(filePath, std::ios::in | std::ios::binary);
  if (!in.is_open()) {
    return std::nullopt;
  }

  std::ostringstream content;
  content << in.rdbuf();
  return content.str();
}

std::string jsonEscape(const std::string& value) {
  std::ostringstream out;
  for (const char ch : value) {
    switch (ch) {
      case '\\':
        out << "\\\\";
        break;
      case '"':
        out << "\\\"";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        out << ch;
        break;
    }
  }
  return out.str();
}

std::optional<std::string> extractJsonString(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"");
  std::smatch match;
  if (!std::regex_search(json, match, pattern) || match.size() < 2) {
    return std::nullopt;
  }

  std::string value = match[1].str();
  value = std::regex_replace(value, std::regex("\\\\\""), "\"");
  value = std::regex_replace(value, std::regex("\\\\n"), "\n");
  value = std::regex_replace(value, std::regex("\\\\r"), "\r");
  value = std::regex_replace(value, std::regex("\\\\t"), "\t");
  value = std::regex_replace(value, std::regex("\\\\\\\\"), "\\");
  return value;
}

std::optional<double> extractJsonNumber(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
  std::smatch match;
  if (!std::regex_search(json, match, pattern) || match.size() < 2) {
    return std::nullopt;
  }

  try {
    return std::stod(match[1].str());
  } catch (...) {
    return std::nullopt;
  }
}

std::vector<std::string> extractJsonStringArray(const std::string& json, const std::string& key) {
  const std::regex arrayPattern("\\\"" + key + "\\\"\\s*:\\s*\\[([\\s\\S]*?)\\]");
  std::smatch arrayMatch;
  if (!std::regex_search(json, arrayMatch, arrayPattern) || arrayMatch.size() < 2) {
    return {};
  }

  std::vector<std::string> output;
  const std::string raw = arrayMatch[1].str();
  const std::regex itemPattern("\\\"((?:\\\\.|[^\\\"])*)\\\"");
  auto begin = std::sregex_iterator(raw.begin(), raw.end(), itemPattern);
  auto end = std::sregex_iterator();
  for (auto it = begin; it != end; ++it) {
    std::string value = (*it)[1].str();
    value = std::regex_replace(value, std::regex("\\\\\""), "\"");
    value = std::regex_replace(value, std::regex("\\\\\\\\"), "\\");
    output.push_back(value);
  }

  return output;
}

std::string lower(const std::string& value) {
  std::string out = value;
  std::transform(out.begin(), out.end(), out.begin(), [](const unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return out;
}

std::string normalize(const std::string& value) {
  std::string out;
  out.reserve(value.size());
  for (const unsigned char ch : value) {
    if (!std::isspace(ch)) {
      out.push_back(static_cast<char>(std::tolower(ch)));
    }
  }
  return out;
}

bool looksDomainLike(const std::string& token) {
  if (token.size() <= 1) {
    return true;
  }

  bool hasDigit = false;
  bool hasUpper = false;
  bool hasLower = false;
  for (const unsigned char ch : token) {
    if (std::isdigit(ch)) {
      hasDigit = true;
    }
    if (std::isupper(ch)) {
      hasUpper = true;
    }
    if (std::islower(ch)) {
      hasLower = true;
    }
  }

  if (token.find('_') != std::string::npos || token.find('-') != std::string::npos) {
    return true;
  }

  if (hasDigit && hasUpper) {
    return true;
  }

  return token.size() >= 8 && hasUpper && hasLower && token.find(' ') == std::string::npos;
}

int boundedDamerauLevenshtein(const std::string& left, const std::string& right, const int maxDistance) {
  const int leftLen = static_cast<int>(left.size());
  const int rightLen = static_cast<int>(right.size());
  if (std::abs(leftLen - rightLen) > maxDistance) {
    return maxDistance + 1;
  }

  std::vector<int> prevPrev(rightLen + 1, 0);
  std::vector<int> prev(rightLen + 1, 0);
  std::vector<int> cur(rightLen + 1, 0);

  for (int j = 0; j <= rightLen; ++j) {
    prev[j] = j;
  }

  for (int i = 1; i <= leftLen; ++i) {
    cur[0] = i;
    int minInRow = cur[0];

    for (int j = 1; j <= rightLen; ++j) {
      const int cost = left[i - 1] == right[j - 1] ? 0 : 1;
      const int del = prev[j] + 1;
      const int ins = cur[j - 1] + 1;
      const int sub = prev[j - 1] + cost;
      int value = std::min({del, ins, sub});

      if (i > 1 && j > 1 && left[i - 1] == right[j - 2] && left[i - 2] == right[j - 1]) {
        value = std::min(value, prevPrev[j - 2] + 1);
      }

      cur[j] = value;
      if (value < minInRow) {
        minInRow = value;
      }
    }

    if (minInRow > maxDistance) {
      return maxDistance + 1;
    }

    prevPrev = prev;
    prev = cur;
    std::fill(cur.begin(), cur.end(), 0);
  }

  return prev[rightLen];
}

bool loadTfLiteApi(const std::string& runtimeRoot, TfLiteApi* api, std::string* detail) {
  const std::vector<std::string> candidates = {
    runtimeRoot + "/lib/libtensorflowlite_c.dylib",
    "libtensorflowlite_c.dylib"
  };

  for (const auto& candidate : candidates) {
    void* handle = dlopen(candidate.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
      continue;
    }

    api->handle = handle;
    api->modelCreateFromFile = reinterpret_cast<TfLiteModelCreateFromFileFn>(dlsym(handle, "TfLiteModelCreateFromFile"));
    api->modelDelete = reinterpret_cast<TfLiteModelDeleteFn>(dlsym(handle, "TfLiteModelDelete"));
    api->optionsCreate = reinterpret_cast<TfLiteInterpreterOptionsCreateFn>(dlsym(handle, "TfLiteInterpreterOptionsCreate"));
    api->optionsDelete = reinterpret_cast<TfLiteInterpreterOptionsDeleteFn>(dlsym(handle, "TfLiteInterpreterOptionsDelete"));
    api->optionsSetNumThreads = reinterpret_cast<TfLiteInterpreterOptionsSetNumThreadsFn>(dlsym(handle, "TfLiteInterpreterOptionsSetNumThreads"));
    api->optionsAddDelegate = reinterpret_cast<TfLiteInterpreterOptionsAddDelegateFn>(dlsym(handle, "TfLiteInterpreterOptionsAddDelegate"));
    api->interpreterCreate = reinterpret_cast<TfLiteInterpreterCreateFn>(dlsym(handle, "TfLiteInterpreterCreate"));
    api->interpreterDelete = reinterpret_cast<TfLiteInterpreterDeleteFn>(dlsym(handle, "TfLiteInterpreterDelete"));
    api->allocateTensors = reinterpret_cast<TfLiteInterpreterAllocateTensorsFn>(dlsym(handle, "TfLiteInterpreterAllocateTensors"));
    api->getInputTensor = reinterpret_cast<TfLiteInterpreterGetInputTensorFn>(dlsym(handle, "TfLiteInterpreterGetInputTensor"));
    api->getOutputTensor = reinterpret_cast<TfLiteInterpreterGetOutputTensorFn>(dlsym(handle, "TfLiteInterpreterGetOutputTensor"));
    api->invoke = reinterpret_cast<TfLiteInterpreterInvokeFn>(dlsym(handle, "TfLiteInterpreterInvoke"));
    api->tensorByteSize = reinterpret_cast<TfLiteTensorByteSizeFn>(dlsym(handle, "TfLiteTensorByteSize"));
    api->tensorCopyFromBuffer = reinterpret_cast<TfLiteTensorCopyFromBufferFn>(dlsym(handle, "TfLiteTensorCopyFromBuffer"));
    api->tensorCopyToBuffer = reinterpret_cast<TfLiteTensorCopyToBufferFn>(dlsym(handle, "TfLiteTensorCopyToBuffer"));

    const bool complete =
      api->modelCreateFromFile && api->modelDelete && api->optionsCreate && api->optionsDelete &&
      api->optionsSetNumThreads && api->optionsAddDelegate && api->interpreterCreate &&
      api->interpreterDelete && api->allocateTensors && api->getInputTensor &&
      api->getOutputTensor && api->invoke && api->tensorByteSize &&
      api->tensorCopyFromBuffer && api->tensorCopyToBuffer;

    if (complete) {
      *detail = "tensorflowlite_c loaded from '" + candidate + "'";
      return true;
    }

    dlclose(handle);
    api->handle = nullptr;
  }

  *detail = "tensorflowlite_c library not found";
  return false;
}

bool loadEdgeTpuApi(const std::string& runtimeRoot, EdgeTpuApi* api, std::string* detail) {
  const std::vector<std::string> candidates = {
    runtimeRoot + "/lib/libedgetpu.1.dylib",
    "libedgetpu.1.dylib"
  };

  for (const auto& candidate : candidates) {
    void* handle = dlopen(candidate.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
      continue;
    }

    api->handle = handle;
    api->createDelegate = reinterpret_cast<EdgeTpuCreateDelegateFn>(dlsym(handle, "edgetpu_create_delegate"));
    api->freeDelegate = reinterpret_cast<EdgeTpuFreeDelegateFn>(dlsym(handle, "edgetpu_free_delegate"));

    if (api->createDelegate && api->freeDelegate) {
      *detail = "libedgetpu loaded from '" + candidate + "'";
      return true;
    }

    dlclose(handle);
    api->handle = nullptr;
  }

  *detail = "libedgetpu not found";
  return false;
}

std::string dirnameOf(const std::string& fullPath) {
  const auto pos = fullPath.find_last_of('/');
  if (pos == std::string::npos) {
    return ".";
  }
  return fullPath.substr(0, pos);
}

Profile loadProfile(const std::string& modelPath) {
  Profile profile;
  if (modelPath.empty()) {
    return profile;
  }

  const auto metaPath = modelPath + ".meta.json";
  const auto meta = readFile(metaPath);
  if (!meta.has_value()) {
    return profile;
  }

  if (const auto id = extractJsonString(*meta, "id"); id.has_value() && !id->empty()) {
    profile.id = *id;
  }
  if (const auto displayName = extractJsonString(*meta, "displayName"); displayName.has_value() && !displayName->empty()) {
    profile.displayName = *displayName;
  }

  if (const auto n = extractJsonNumber(*meta, "intercept"); n.has_value()) profile.intercept = *n;
  if (const auto n = extractJsonNumber(*meta, "distanceWeight"); n.has_value()) profile.distanceWeight = *n;
  if (const auto n = extractJsonNumber(*meta, "similarityWeight"); n.has_value()) profile.similarityWeight = *n;
  if (const auto n = extractJsonNumber(*meta, "identifierBoost"); n.has_value()) profile.identifierBoost = *n;
  if (const auto n = extractJsonNumber(*meta, "literalBoost"); n.has_value()) profile.literalBoost = *n;
  if (const auto n = extractJsonNumber(*meta, "longTokenBoost"); n.has_value()) profile.longTokenBoost = *n;
  if (const auto n = extractJsonNumber(*meta, "shortTokenPenalty"); n.has_value()) profile.shortTokenPenalty = *n;
  if (const auto n = extractJsonNumber(*meta, "typoThreshold"); n.has_value()) profile.typoThreshold = clamp(*n, 0.5, 0.98);
  if (const auto n = extractJsonNumber(*meta, "notTypoThreshold"); n.has_value()) profile.notTypoThreshold = clamp(*n, 0.02, 0.5);

  return profile;
}

ClassifierRequest parseRequest(const std::string& payload) {
  ClassifierRequest req;
  if (const auto token = extractJsonString(payload, "token"); token.has_value()) {
    req.token = *token;
  }

  const auto suggestions = extractJsonStringArray(payload, "suggestions");
  if (!suggestions.empty()) {
    req.topSuggestion = suggestions[0];
  }

  if (const auto context = extractJsonString(payload, "context"); context.has_value()) {
    req.context = lower(*context);
  }

  if (const auto modelPath = extractJsonString(payload, "modelPath"); modelPath.has_value()) {
    req.modelPath = *modelPath;
  }

  if (const auto modelId = extractJsonString(payload, "modelId"); modelId.has_value()) {
    req.modelId = *modelId;
  }

  return req;
}

std::array<float, 8> buildFeatureVector(const ClassifierRequest& req) {
  std::array<float, 8> features {};
  const std::string tokenNorm = normalize(req.token);
  const std::string suggestionNorm = normalize(req.topSuggestion);
  const int distance = boundedDamerauLevenshtein(tokenNorm, suggestionNorm, 4);
  const double maxLen = static_cast<double>(std::max(tokenNorm.size(), suggestionNorm.size()));
  const double similarity = maxLen == 0.0 ? 1.0 : 1.0 - static_cast<double>(distance) / maxLen;

  features[0] = static_cast<float>(distance);
  features[1] = static_cast<float>(similarity);
  features[2] = req.context == "identifier" ? 1.0f : 0.0f;
  features[3] = req.context == "literal" ? 1.0f : 0.0f;
  features[4] = tokenNorm.size() >= 9 ? 1.0f : 0.0f;
  features[5] = tokenNorm.size() <= 3 ? 1.0f : 0.0f;
  features[6] = looksDomainLike(req.token) ? 1.0f : 0.0f;
  features[7] = req.topSuggestion.empty() ? 0.0f : 1.0f;
  return features;
}

ClassificationResult classifyHeuristic(const ClassifierRequest& req, const Profile& profile) {
  ClassificationResult out;
  const std::string token = req.token;
  const std::string topSuggestion = req.topSuggestion;
  const std::string context = req.context == "literal" ? "literal" : "identifier";

  const std::string tokenNorm = normalize(token);
  const std::string suggestionNorm = normalize(topSuggestion);
  if (tokenNorm.size() < 2 || suggestionNorm.empty()) {
    out.isTypo = false;
    out.confidence = 0.5;
    out.category = "Uncertain";
    out.backend = "coral-native-heuristic";
    out.reason = "model=" + profile.id + ";insufficient-features";
    return out;
  }

  const int distance = boundedDamerauLevenshtein(tokenNorm, suggestionNorm, 4);
  const double maxLen = static_cast<double>(std::max(tokenNorm.size(), suggestionNorm.size()));
  const double similarity = maxLen == 0.0 ? 1.0 : 1.0 - static_cast<double>(distance) / maxLen;

  double score = profile.intercept;
  score += profile.distanceWeight * static_cast<double>(distance);
  score += profile.similarityWeight * similarity;
  score += (context == "identifier" ? profile.identifierBoost : profile.literalBoost);
  if (tokenNorm.size() >= 9) {
    score += profile.longTokenBoost;
  }
  if (tokenNorm.size() <= 3) {
    score += profile.shortTokenPenalty;
  }
  if (looksDomainLike(token)) {
    score -= 0.14;
  }

  const double typoProbability = clamp(1.0 / (1.0 + std::exp(-score)), 0.0, 1.0);
  if (typoProbability >= profile.typoThreshold) {
    out.category = context == "identifier" ? "IdentifierTypo" : "TextTypo";
  } else if (typoProbability <= profile.notTypoThreshold) {
    out.category = "NotTypo";
  } else {
    out.category = "Uncertain";
  }

  out.isTypo = out.category == "IdentifierTypo" || out.category == "TextTypo";
  if (out.category == "Uncertain") {
    out.confidence = clamp(0.45 + std::abs(typoProbability - 0.5), 0.45, 0.69);
  } else {
    out.confidence = clamp(std::max(typoProbability, 1.0 - typoProbability), 0.55, 0.98);
  }
  out.backend = "coral-native-heuristic";

  std::ostringstream reason;
  reason << "model=" << profile.id
         << ";p=" << std::fixed << std::setprecision(4) << typoProbability
         << ";distance=" << distance
         << ";similarity=" << std::fixed << std::setprecision(4) << similarity;
  out.reason = reason.str();
  return out;
}

bool runTpuInference(
  const AdapterState& state,
  const ClassifierRequest& req,
  const std::array<float, 8>& features,
  ClassificationResult* out,
  std::string* error) {
  if (!state.tpuDelegateReady) {
    *error = "tpu delegate not ready";
    return false;
  }
  if (req.modelPath.empty()) {
    *error = "modelPath missing";
    return false;
  }

  TfLiteModel* model = state.tfLite.modelCreateFromFile(req.modelPath.c_str());
  if (!model) {
    *error = "TfLiteModelCreateFromFile failed";
    return false;
  }

  TfLiteInterpreterOptions* options = state.tfLite.optionsCreate();
  if (!options) {
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterOptionsCreate failed";
    return false;
  }

  state.tfLite.optionsSetNumThreads(options, 1);
  void* delegate = state.edgeTpu.createDelegate(0, nullptr, nullptr, 0);
  if (!delegate) {
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "edgetpu_create_delegate failed";
    return false;
  }

  state.tfLite.optionsAddDelegate(options, reinterpret_cast<TfLiteDelegate*>(delegate));
  TfLiteInterpreter* interpreter = state.tfLite.interpreterCreate(model, options);
  if (!interpreter) {
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterCreate failed";
    return false;
  }

  if (state.tfLite.allocateTensors(interpreter) != kTfLiteOk) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterAllocateTensors failed";
    return false;
  }

  TfLiteTensor* input = state.tfLite.getInputTensor(interpreter, 0);
  if (!input) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "input tensor missing";
    return false;
  }

  const size_t inputBytes = state.tfLite.tensorByteSize(input);
  if (inputBytes < features.size() * sizeof(float)) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "input tensor too small (expected >= 8 floats)";
    return false;
  }

  if (state.tfLite.tensorCopyFromBuffer(input, features.data(), features.size() * sizeof(float)) != kTfLiteOk) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "tensorCopyFromBuffer failed";
    return false;
  }

  if (state.tfLite.invoke(interpreter) != kTfLiteOk) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterInvoke failed";
    return false;
  }

  const TfLiteTensor* outputTensor = state.tfLite.getOutputTensor(interpreter, 0);
  if (!outputTensor) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "output tensor missing";
    return false;
  }

  const size_t outputBytes = state.tfLite.tensorByteSize(outputTensor);
  if (outputBytes < 4 * sizeof(float)) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "output tensor too small (expected >= 4 floats)";
    return false;
  }

  std::array<float, 4> outputValues {};
  if (state.tfLite.tensorCopyToBuffer(outputTensor, outputValues.data(), outputValues.size() * sizeof(float)) != kTfLiteOk) {
    state.tfLite.interpreterDelete(interpreter);
    state.edgeTpu.freeDelegate(delegate);
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "tensorCopyToBuffer failed";
    return false;
  }

  state.tfLite.interpreterDelete(interpreter);
  state.edgeTpu.freeDelegate(delegate);
  state.tfLite.optionsDelete(options);
  state.tfLite.modelDelete(model);

  int maxIndex = 0;
  for (int i = 1; i < 4; ++i) {
    if (outputValues[static_cast<size_t>(i)] > outputValues[static_cast<size_t>(maxIndex)]) {
      maxIndex = i;
    }
  }

  const std::array<std::string, 4> categories = {
    "IdentifierTypo", "TextTypo", "NotTypo", "Uncertain"
  };

  out->category = categories[static_cast<size_t>(maxIndex)];
  out->isTypo = out->category == "IdentifierTypo" || out->category == "TextTypo";
  out->confidence = clamp(outputValues[static_cast<size_t>(maxIndex)], 0.0f, 1.0f);
  out->backend = "coral-native-tpu";
  out->reason = "tpu-inference";
  return true;
}

AdapterState buildAdapterState(const std::string& modelPath) {
  AdapterState state;

  const std::string runtimeRoot = dirnameOf(dirnameOf(modelPath));
  std::string tfLiteDetail;
  std::string edgeDetail;
  const bool tfLiteOk = loadTfLiteApi(runtimeRoot, &state.tfLite, &tfLiteDetail);
  const bool edgeOk = loadEdgeTpuApi(runtimeRoot, &state.edgeTpu, &edgeDetail);

  state.tpuDelegateReady = false;
  if (tfLiteOk && edgeOk) {
    void* delegate = state.edgeTpu.createDelegate(0, nullptr, nullptr, 0);
    if (delegate != nullptr) {
      state.edgeTpu.freeDelegate(delegate);
      state.tpuDelegateReady = true;
      state.detail = tfLiteDetail + "; " + edgeDetail + "; delegate init ok";
    } else {
      state.detail = tfLiteDetail + "; " + edgeDetail + "; delegate init failed";
    }
  } else {
    state.detail = tfLiteDetail + "; " + edgeDetail;
  }

  return state;
}

void cleanupAdapterState(AdapterState* state) {
  if (state->tfLite.handle) {
    dlclose(state->tfLite.handle);
    state->tfLite.handle = nullptr;
  }
  if (state->edgeTpu.handle) {
    dlclose(state->edgeTpu.handle);
    state->edgeTpu.handle = nullptr;
  }
}

std::string toJson(const ClassificationResult& result) {
  std::ostringstream out;
  out << "{";
  out << "\"isTypo\":" << (result.isTypo ? "true" : "false") << ",";
  out << "\"confidence\":" << std::fixed << std::setprecision(6) << result.confidence << ",";
  out << "\"category\":\"" << jsonEscape(result.category) << "\",";
  out << "\"backend\":\"" << jsonEscape(result.backend) << "\",";
  out << "\"reason\":\"" << jsonEscape(result.reason) << "\"";
  out << "}";
  return out.str();
}

std::string healthJson(const AdapterState& state, const Profile& profile) {
  std::ostringstream out;
  out << "{";
  out << "\"backend\":\"coral-native\",";
  out << "\"tpuInferenceActive\":" << (state.tpuDelegateReady ? "true" : "false") << ",";
  out << "\"detail\":\"" << jsonEscape(state.detail + "; profile='" + profile.id + "'" ) << "\"";
  out << "}";
  return out.str();
}

}  // namespace

int main(int argc, char** argv) {
  bool healthMode = false;
  std::string modelPath;

  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--health") {
      healthMode = true;
      continue;
    }

    if (arg == "--model" && i + 1 < argc) {
      modelPath = argv[i + 1];
      ++i;
      continue;
    }
  }

  if (healthMode) {
    const Profile profile = loadProfile(modelPath);
    AdapterState state = buildAdapterState(modelPath);
    std::cout << healthJson(state, profile);
    cleanupAdapterState(&state);
    return 0;
  }

  const std::string payload = readAllStdin();
  if (payload.empty()) {
    std::cerr << "coral-native-adapter: empty stdin payload" << std::endl;
    return 1;
  }

  const ClassifierRequest req = parseRequest(payload);
  const Profile profile = loadProfile(req.modelPath);
  const auto features = buildFeatureVector(req);

  AdapterState state = buildAdapterState(req.modelPath);
  ClassificationResult result;
  std::string tpuError;
  if (runTpuInference(state, req, features, &result, &tpuError)) {
    if (result.reason.empty()) {
      result.reason = "tpu-inference";
    }
  } else {
    result = classifyHeuristic(req, profile);
    result.reason += ";fallback=" + tpuError;
  }

  std::cout << toJson(result);
  cleanupAdapterState(&state);
  return 0;
}
