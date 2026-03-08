#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
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

enum TfLiteType {
  kTfLiteNoType = 0,
  kTfLiteFloat32 = 1,
  kTfLiteInt32 = 2,
  kTfLiteUInt8 = 3,
  kTfLiteInt64 = 4,
  kTfLiteString = 5,
  kTfLiteBool = 6,
  kTfLiteInt16 = 7,
  kTfLiteComplex64 = 8,
  kTfLiteInt8 = 9
};

struct TfLiteQuantizationParams {
  float scale;
  int zero_point;
};

constexpr size_t kFeatureCount = 14;
using FeatureVector = std::array<float, kFeatureCount>;

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
using TfLiteTensorTypeFn = TfLiteType (*)(const TfLiteTensor*);
using TfLiteTensorQuantizationParamsFn = TfLiteQuantizationParams (*)(const TfLiteTensor*);
using TfLiteTensorCopyFromBufferFn = TfLiteStatus (*)(TfLiteTensor*, const void*, size_t);
using TfLiteTensorCopyToBufferFn = TfLiteStatus (*)(const TfLiteTensor*, void*, size_t);

using EdgeTpuCreateDelegateFn = void* (*)(int, const char*, const void*, size_t);
using EdgeTpuFreeDelegateFn = void (*)(void*);
struct EdgeTpuDeviceInfo {
  int type;
  const char* path;
};
using EdgeTpuListDevicesFn = EdgeTpuDeviceInfo* (*)(size_t*);
using EdgeTpuFreeDevicesFn = void (*)(EdgeTpuDeviceInfo*);

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
  TfLiteTensorTypeFn tensorType = nullptr;
  TfLiteTensorQuantizationParamsFn tensorQuantizationParams = nullptr;
  TfLiteTensorCopyFromBufferFn tensorCopyFromBuffer = nullptr;
  TfLiteTensorCopyToBufferFn tensorCopyToBuffer = nullptr;
};

struct EdgeTpuApi {
  void* handle = nullptr;
  EdgeTpuCreateDelegateFn createDelegate = nullptr;
  EdgeTpuFreeDelegateFn freeDelegate = nullptr;
  EdgeTpuListDevicesFn listDevices = nullptr;
  EdgeTpuFreeDevicesFn freeDevices = nullptr;
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

struct ModelRuntimeSpec {
  std::string id = "runtime-default";
  std::vector<std::string> labels {"IdentifierTypo", "TextTypo", "NotTypo"};
  double uncertainTop1Threshold = 0.60;
  double uncertainMarginThreshold = 0.10;
  bool edgeTpuCompiled = false;
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
  bool tfLiteLoaded = false;
  bool edgeTpuLoaded = false;
  bool tpuDelegateReady = false;
  bool tpuInferenceActive = false;
  bool modelLoadable = false;
  bool modelPlaceholder = false;
  bool modelEdgeTpuCompiled = false;
  int activeDelegateType = -1;
  std::string activeDelegatePath;
  std::string detail;
};

constexpr int kEdgeTpuApexPci = 0;
constexpr int kEdgeTpuApexUsb = 1;

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

std::optional<bool> extractJsonBool(const std::string& json, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*(true|false)", std::regex::icase);
  std::smatch match;
  if (!std::regex_search(json, match, pattern) || match.size() < 2) {
    return std::nullopt;
  }

  std::string value = match[1].str();
  std::transform(value.begin(), value.end(), value.begin(), [](const unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value == "true";
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

bool containsNonAscii(const std::string& value) {
  for (const unsigned char ch : value) {
    if (ch > 127) {
      return true;
    }
  }
  return false;
}

std::string foldHuEnAccents(const std::string& value) {
  std::string out = value;
  const std::array<std::pair<const char*, const char*>, 18> replacements = {{
    {"á", "a"}, {"é", "e"}, {"í", "i"}, {"ó", "o"}, {"ö", "o"}, {"ő", "o"},
    {"ú", "u"}, {"ü", "u"}, {"ű", "u"},
    {"Á", "a"}, {"É", "e"}, {"Í", "i"}, {"Ó", "o"}, {"Ö", "o"}, {"Ő", "o"},
    {"Ú", "u"}, {"Ü", "u"}, {"Ű", "u"}
  }};
  for (const auto& item : replacements) {
    size_t pos = 0;
    while ((pos = out.find(item.first, pos)) != std::string::npos) {
      out.replace(pos, std::strlen(item.first), item.second);
      pos += std::strlen(item.second);
    }
  }
  return lower(out);
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
    api->tensorType = reinterpret_cast<TfLiteTensorTypeFn>(dlsym(handle, "TfLiteTensorType"));
    api->tensorQuantizationParams = reinterpret_cast<TfLiteTensorQuantizationParamsFn>(dlsym(handle, "TfLiteTensorQuantizationParams"));
    api->tensorCopyFromBuffer = reinterpret_cast<TfLiteTensorCopyFromBufferFn>(dlsym(handle, "TfLiteTensorCopyFromBuffer"));
    api->tensorCopyToBuffer = reinterpret_cast<TfLiteTensorCopyToBufferFn>(dlsym(handle, "TfLiteTensorCopyToBuffer"));

    const bool complete =
      api->modelCreateFromFile && api->modelDelete && api->optionsCreate && api->optionsDelete &&
      api->optionsSetNumThreads && api->optionsAddDelegate && api->interpreterCreate &&
      api->interpreterDelete && api->allocateTensors && api->getInputTensor &&
      api->getOutputTensor && api->invoke && api->tensorByteSize &&
      api->tensorType && api->tensorQuantizationParams &&
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
    api->listDevices = reinterpret_cast<EdgeTpuListDevicesFn>(dlsym(handle, "edgetpu_list_devices"));
    api->freeDevices = reinterpret_cast<EdgeTpuFreeDevicesFn>(dlsym(handle, "edgetpu_free_devices"));

    const bool hasDeviceEnumeration = (api->listDevices != nullptr && api->freeDevices != nullptr);
    if (api->createDelegate && api->freeDelegate) {
      *detail = "libedgetpu loaded from '" + candidate + "'";
      if (!hasDeviceEnumeration) {
        *detail += "; edgetpu_list_devices unavailable";
      }
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

bool isLikelyPlaceholderModel(const std::string& modelPath) {
  std::ifstream in(modelPath, std::ios::in | std::ios::binary);
  if (!in.is_open()) {
    return false;
  }

  std::array<char, 256> buffer {};
  in.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
  const std::streamsize readBytes = in.gcount();
  if (readBytes <= 0) {
    return false;
  }

  const std::string prefix(buffer.data(), static_cast<size_t>(readBytes));
  const std::string normalized = lower(prefix);
  if (normalized.find("placeholder_binary_payload") == std::string::npos) {
    return false;
  }

  return normalized.find("kospellcheck") != std::string::npos;
}

std::string delegateTypeToText(const int delegateType) {
  if (delegateType == kEdgeTpuApexUsb) {
    return "usb";
  }
  if (delegateType == kEdgeTpuApexPci) {
    return "pci";
  }
  return "unknown";
}

bool tryCreateAndReleaseDelegate(
  const EdgeTpuApi& edgeTpu,
  int delegateType,
  const std::string& delegatePath) {
  const char* delegateName = delegatePath.empty() ? nullptr : delegatePath.c_str();
  void* delegate = edgeTpu.createDelegate(delegateType, delegateName, nullptr, 0);
  if (!delegate && delegateName != nullptr) {
    delegate = edgeTpu.createDelegate(delegateType, nullptr, nullptr, 0);
  }
  if (!delegate) {
    return false;
  }

  edgeTpu.freeDelegate(delegate);
  return true;
}

void appendDiscoveredDeviceList(const std::vector<std::pair<int, std::string>>& devices, std::string* detail) {
  if (devices.empty()) {
    *detail += "; discoveredDevices=0";
    return;
  }

  *detail += "; discoveredDevices=" + std::to_string(devices.size()) + " [";
  for (size_t i = 0; i < devices.size(); ++i) {
    if (i > 0) {
      *detail += ", ";
    }
    *detail += delegateTypeToText(devices[i].first);
    *detail += ":";
    *detail += devices[i].second.empty() ? "<auto>" : devices[i].second;
  }
  *detail += "]";
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

ModelRuntimeSpec loadModelRuntimeSpec(const std::string& modelPath) {
  ModelRuntimeSpec spec;
  if (modelPath.empty()) {
    return spec;
  }

  const auto metaPath = modelPath + ".meta.json";
  const auto meta = readFile(metaPath);
  if (!meta.has_value()) {
    return spec;
  }

  if (const auto id = extractJsonString(*meta, "id"); id.has_value() && !id->empty()) {
    spec.id = *id;
  }

  const auto labels = extractJsonStringArray(*meta, "labels");
  if (!labels.empty()) {
    spec.labels = labels;
  }

  if (const auto threshold = extractJsonNumber(*meta, "uncertainTop1Threshold"); threshold.has_value()) {
    spec.uncertainTop1Threshold = clamp(*threshold, 0.45, 0.95);
  }
  if (const auto threshold = extractJsonNumber(*meta, "uncertainMarginThreshold"); threshold.has_value()) {
    spec.uncertainMarginThreshold = clamp(*threshold, 0.01, 0.40);
  }
  if (const auto compiled = extractJsonBool(*meta, "edgeTpuCompiled"); compiled.has_value()) {
    spec.edgeTpuCompiled = *compiled;
  }

  return spec;
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

FeatureVector buildFeatureVector(const ClassifierRequest& req) {
  FeatureVector features {};
  const std::string tokenNorm = normalize(req.token);
  const std::string suggestionNorm = normalize(req.topSuggestion);
  const int distance = boundedDamerauLevenshtein(tokenNorm, suggestionNorm, 4);
  const double maxLen = static_cast<double>(std::max(tokenNorm.size(), suggestionNorm.size()));
  const double similarity = maxLen == 0.0 ? 1.0 : 1.0 - static_cast<double>(distance) / maxLen;
  const std::string tokenFolded = foldHuEnAccents(req.token);
  const std::string suggestionFolded = foldHuEnAccents(req.topSuggestion);
  const bool sameFirst = !tokenNorm.empty() && !suggestionNorm.empty() && tokenNorm.front() == suggestionNorm.front();
  const bool sameLast = !tokenNorm.empty() && !suggestionNorm.empty() && tokenNorm.back() == suggestionNorm.back();
  const bool accentsOnlyDifference =
    !tokenNorm.empty() &&
    !suggestionNorm.empty() &&
    tokenNorm != suggestionNorm &&
    tokenFolded == suggestionFolded;

  features[0] = static_cast<float>(distance);
  features[1] = static_cast<float>(similarity);
  features[2] = req.context == "identifier" ? 1.0f : 0.0f;
  features[3] = req.context == "literal" ? 1.0f : 0.0f;
  features[4] = tokenNorm.size() >= 9 ? 1.0f : 0.0f;
  features[5] = tokenNorm.size() <= 3 ? 1.0f : 0.0f;
  features[6] = looksDomainLike(req.token) ? 1.0f : 0.0f;
  features[7] = req.topSuggestion.empty() ? 0.0f : 1.0f;
  features[8] = containsNonAscii(req.token) ? 1.0f : 0.0f;
  features[9] = containsNonAscii(req.topSuggestion) ? 1.0f : 0.0f;
  features[10] = sameFirst ? 1.0f : 0.0f;
  features[11] = sameLast ? 1.0f : 0.0f;
  features[12] = accentsOnlyDifference ? 1.0f : 0.0f;
  features[13] =
    maxLen == 0.0
      ? 0.0f
      : static_cast<float>(
          static_cast<double>(std::abs(static_cast<int>(tokenNorm.size()) - static_cast<int>(suggestionNorm.size()))) /
          maxLen);
  return features;
}

size_t bytesPerElement(const TfLiteType type) {
  switch (type) {
    case kTfLiteFloat32:
      return sizeof(float);
    case kTfLiteInt8:
      return sizeof(int8_t);
    case kTfLiteUInt8:
      return sizeof(uint8_t);
    default:
      return 0;
  }
}

bool copyFeaturesToTensor(
  const TfLiteApi& tfLite,
  TfLiteTensor* tensor,
  const FeatureVector& features,
  std::string* error) {
  const TfLiteType tensorType = tfLite.tensorType(tensor);
  const size_t elementSize = bytesPerElement(tensorType);
  if (elementSize == 0) {
    *error = "unsupported input tensor type";
    return false;
  }

  const size_t tensorBytes = tfLite.tensorByteSize(tensor);
  if (tensorBytes < features.size() * elementSize) {
    *error = "input tensor too small";
    return false;
  }

  if (tensorType == kTfLiteFloat32) {
    return tfLite.tensorCopyFromBuffer(tensor, features.data(), features.size() * sizeof(float)) == kTfLiteOk;
  }

  const TfLiteQuantizationParams quantization = tfLite.tensorQuantizationParams(tensor);
  if (quantization.scale <= 0.0f) {
    *error = "input tensor quantization invalid";
    return false;
  }

  if (tensorType == kTfLiteInt8) {
    std::array<int8_t, kFeatureCount> quantized {};
    for (size_t i = 0; i < features.size(); ++i) {
      const int value = static_cast<int>(std::lround(features[i] / quantization.scale)) + quantization.zero_point;
      quantized[i] = static_cast<int8_t>(std::clamp(value, -128, 127));
    }
    return tfLite.tensorCopyFromBuffer(tensor, quantized.data(), quantized.size() * sizeof(int8_t)) == kTfLiteOk;
  }

  std::array<uint8_t, kFeatureCount> quantized {};
  for (size_t i = 0; i < features.size(); ++i) {
    const int value = static_cast<int>(std::lround(features[i] / quantization.scale)) + quantization.zero_point;
    quantized[i] = static_cast<uint8_t>(std::clamp(value, 0, 255));
  }
  return tfLite.tensorCopyFromBuffer(tensor, quantized.data(), quantized.size() * sizeof(uint8_t)) == kTfLiteOk;
}

bool readTensorValues(
  const TfLiteApi& tfLite,
  const TfLiteTensor* tensor,
  std::vector<double>* output,
  std::string* error) {
  const TfLiteType tensorType = tfLite.tensorType(tensor);
  const size_t elementSize = bytesPerElement(tensorType);
  if (elementSize == 0) {
    *error = "unsupported output tensor type";
    return false;
  }

  const size_t tensorBytes = tfLite.tensorByteSize(tensor);
  const size_t elementCount = tensorBytes / elementSize;
  if (elementCount < 3) {
    *error = "output tensor has fewer than 3 elements";
    return false;
  }

  output->assign(elementCount, 0.0);
  if (tensorType == kTfLiteFloat32) {
    std::vector<float> raw(elementCount, 0.0f);
    if (tfLite.tensorCopyToBuffer(tensor, raw.data(), raw.size() * sizeof(float)) != kTfLiteOk) {
      *error = "tensorCopyToBuffer failed";
      return false;
    }
    for (size_t i = 0; i < raw.size(); ++i) {
      (*output)[i] = raw[i];
    }
    return true;
  }

  const TfLiteQuantizationParams quantization = tfLite.tensorQuantizationParams(tensor);
  if (quantization.scale <= 0.0f) {
    *error = "output tensor quantization invalid";
    return false;
  }

  if (tensorType == kTfLiteInt8) {
    std::vector<int8_t> raw(elementCount, 0);
    if (tfLite.tensorCopyToBuffer(tensor, raw.data(), raw.size() * sizeof(int8_t)) != kTfLiteOk) {
      *error = "tensorCopyToBuffer failed";
      return false;
    }
    for (size_t i = 0; i < raw.size(); ++i) {
      (*output)[i] = quantization.scale * (static_cast<int>(raw[i]) - quantization.zero_point);
    }
    return true;
  }

  std::vector<uint8_t> raw(elementCount, 0);
  if (tfLite.tensorCopyToBuffer(tensor, raw.data(), raw.size() * sizeof(uint8_t)) != kTfLiteOk) {
    *error = "tensorCopyToBuffer failed";
    return false;
  }
  for (size_t i = 0; i < raw.size(); ++i) {
    (*output)[i] = quantization.scale * (static_cast<int>(raw[i]) - quantization.zero_point);
  }
  return true;
}

std::vector<double> normalizeProbabilities(std::vector<double> values) {
  if (values.empty()) {
    return values;
  }

  bool needsSoftmax = false;
  double sum = 0.0;
  for (const double value : values) {
    if (value < -0.01 || value > 1.01) {
      needsSoftmax = true;
    }
    sum += value;
  }
  if (sum < 0.75 || sum > 1.25) {
    needsSoftmax = true;
  }

  if (needsSoftmax) {
    const double maxValue = *std::max_element(values.begin(), values.end());
    double denominator = 0.0;
    for (double& value : values) {
      value = std::exp(value - maxValue);
      denominator += value;
    }
    if (denominator <= 0.0) {
      return std::vector<double>(values.size(), 1.0 / static_cast<double>(values.size()));
    }
    for (double& value : values) {
      value /= denominator;
    }
    return values;
  }

  for (double& value : values) {
    value = clamp(value, 0.0, 1.0);
  }
  return values;
}

ClassificationResult classifyFromModelOutput(
  const std::vector<double>& outputValues,
  const ModelRuntimeSpec& modelSpec,
  const std::string& backend,
  const std::string& reasonPrefix) {
  ClassificationResult out;
  if (outputValues.empty()) {
    out.backend = backend;
    out.reason = reasonPrefix + ";empty-output";
    return out;
  }

  const std::vector<double> probabilities = normalizeProbabilities(outputValues);
  size_t topIndex = 0;
  size_t secondIndex = 0;
  for (size_t i = 1; i < probabilities.size(); ++i) {
    if (probabilities[i] > probabilities[topIndex]) {
      secondIndex = topIndex;
      topIndex = i;
    } else if (i != topIndex && (secondIndex == topIndex || probabilities[i] > probabilities[secondIndex])) {
      secondIndex = i;
    }
  }

  const double topProbability = probabilities[topIndex];
  const double secondProbability =
    probabilities.size() > 1 && secondIndex < probabilities.size() && secondIndex != topIndex
      ? probabilities[secondIndex]
      : 0.0;
  const double margin = topProbability - secondProbability;
  const std::string predictedCategory =
    topIndex < modelSpec.labels.size() ? modelSpec.labels[topIndex] : "Uncertain";

  if (
    modelSpec.labels.size() == 3 &&
    (topProbability < modelSpec.uncertainTop1Threshold || margin < modelSpec.uncertainMarginThreshold)) {
    out.category = "Uncertain";
  } else {
    out.category = predictedCategory;
  }

  out.isTypo = out.category == "IdentifierTypo" || out.category == "TextTypo";
  out.confidence = clamp(topProbability, 0.0, 1.0);
  out.backend = backend;

  std::ostringstream reason;
  reason << reasonPrefix
         << ";top=" << predictedCategory
         << ";p=" << std::fixed << std::setprecision(4) << topProbability
         << ";margin=" << std::fixed << std::setprecision(4) << margin;
  out.reason = reason.str();
  return out;
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

bool runInferenceWithOptionalDelegate(
  const AdapterState& state,
  const std::string& modelPath,
  const FeatureVector& features,
  bool useDelegate,
  std::vector<double>* outputValues,
  std::string* error) {
  TfLiteModel* model = state.tfLite.modelCreateFromFile(modelPath.c_str());
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

  void* delegate = nullptr;
  int delegateType = state.activeDelegateType >= 0 ? state.activeDelegateType : kEdgeTpuApexUsb;
  if (useDelegate) {
    const char* preferredDelegatePath =
      state.activeDelegatePath.empty() ? nullptr : state.activeDelegatePath.c_str();
    delegate = state.edgeTpu.createDelegate(delegateType, preferredDelegatePath, nullptr, 0);
    if (!delegate && preferredDelegatePath != nullptr) {
      delegate = state.edgeTpu.createDelegate(delegateType, nullptr, nullptr, 0);
    }
    if (!delegate && delegateType != kEdgeTpuApexPci) {
      delegateType = kEdgeTpuApexPci;
      delegate = state.edgeTpu.createDelegate(delegateType, nullptr, nullptr, 0);
    }
    if (!delegate) {
      state.tfLite.optionsDelete(options);
      state.tfLite.modelDelete(model);
      *error = "edgetpu_create_delegate failed (type=" + delegateTypeToText(delegateType) + ")";
      return false;
    }
    state.tfLite.optionsAddDelegate(options, reinterpret_cast<TfLiteDelegate*>(delegate));
  }

  TfLiteInterpreter* interpreter = state.tfLite.interpreterCreate(model, options);
  if (!interpreter) {
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterCreate failed";
    return false;
  }

  if (state.tfLite.allocateTensors(interpreter) != kTfLiteOk) {
    state.tfLite.interpreterDelete(interpreter);
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterAllocateTensors failed";
    return false;
  }

  TfLiteTensor* input = state.tfLite.getInputTensor(interpreter, 0);
  if (!input) {
    state.tfLite.interpreterDelete(interpreter);
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "input tensor missing";
    return false;
  }

  std::string tensorError;
  if (!copyFeaturesToTensor(state.tfLite, input, features, &tensorError)) {
    state.tfLite.interpreterDelete(interpreter);
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = tensorError.empty() ? "tensorCopyFromBuffer failed" : tensorError;
    return false;
  }

  if (state.tfLite.invoke(interpreter) != kTfLiteOk) {
    state.tfLite.interpreterDelete(interpreter);
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "TfLiteInterpreterInvoke failed";
    return false;
  }

  const TfLiteTensor* outputTensor = state.tfLite.getOutputTensor(interpreter, 0);
  if (!outputTensor) {
    state.tfLite.interpreterDelete(interpreter);
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = "output tensor missing";
    return false;
  }

  if (!readTensorValues(state.tfLite, outputTensor, outputValues, &tensorError)) {
    state.tfLite.interpreterDelete(interpreter);
    if (delegate) {
      state.edgeTpu.freeDelegate(delegate);
    }
    state.tfLite.optionsDelete(options);
    state.tfLite.modelDelete(model);
    *error = tensorError.empty() ? "tensorCopyToBuffer failed" : tensorError;
    return false;
  }

  state.tfLite.interpreterDelete(interpreter);
  if (delegate) {
    state.edgeTpu.freeDelegate(delegate);
  }
  state.tfLite.optionsDelete(options);
  state.tfLite.modelDelete(model);
  return true;
}

bool runTpuInference(
  const AdapterState& state,
  const ClassifierRequest& req,
  const FeatureVector& features,
  const ModelRuntimeSpec& modelSpec,
  ClassificationResult* out,
  std::string* error) {
  if (!state.tpuDelegateReady) {
    *error = "tpu delegate not ready";
    return false;
  }
  if (!state.modelLoadable) {
    *error = "model not loadable";
    return false;
  }
  if (!state.modelEdgeTpuCompiled && !modelSpec.edgeTpuCompiled) {
    *error = "model not EdgeTPU-compiled";
    return false;
  }
  if (req.modelPath.empty()) {
    *error = "modelPath missing";
    return false;
  }

  std::vector<double> outputValues;
  if (!runInferenceWithOptionalDelegate(state, req.modelPath, features, true, &outputValues, error)) {
    return false;
  }

  *out = classifyFromModelOutput(outputValues, modelSpec, "coral-native-tpu", "tpu-inference");
  return true;
}

bool runLocalTfliteInference(
  const AdapterState& state,
  const ClassifierRequest& req,
  const FeatureVector& features,
  const ModelRuntimeSpec& modelSpec,
  ClassificationResult* out,
  std::string* error) {
  if (!state.tfLiteLoaded) {
    *error = "tflite runtime not loaded";
    return false;
  }
  if (!state.modelLoadable) {
    *error = "model not loadable";
    return false;
  }
  if (req.modelPath.empty()) {
    *error = "modelPath missing";
    return false;
  }

  std::vector<double> outputValues;
  if (!runInferenceWithOptionalDelegate(state, req.modelPath, features, false, &outputValues, error)) {
    return false;
  }

  *out = classifyFromModelOutput(outputValues, modelSpec, "tflite-int8-cpu", "tflite-cpu-inference");
  return true;
}

bool probeTpuInference(
  const AdapterState& state,
  const std::string& modelPath,
  const ModelRuntimeSpec& modelSpec,
  std::string* detail) {
  if (!state.tpuDelegateReady) {
    *detail = "delegate not ready";
    return false;
  }
  if (!state.modelLoadable) {
    *detail = "model not loadable";
    return false;
  }
  if (!modelSpec.edgeTpuCompiled) {
    *detail = "model metadata says edge tpu compiled=false";
    return false;
  }

  FeatureVector zeroFeatures {};
  std::vector<double> outputValues;
  std::string error;
  if (!runInferenceWithOptionalDelegate(state, modelPath, zeroFeatures, true, &outputValues, &error)) {
    *detail = error;
    return false;
  }

  *detail = "delegate inference probe ok";
  return true;
}

AdapterState buildAdapterState(const std::string& modelPath) {
  AdapterState state;
  const ModelRuntimeSpec modelSpec = loadModelRuntimeSpec(modelPath);

  const std::string runtimeRoot = dirnameOf(dirnameOf(modelPath));
  std::string tfLiteDetail;
  std::string edgeDetail;
  const bool tfLiteOk = loadTfLiteApi(runtimeRoot, &state.tfLite, &tfLiteDetail);
  const bool edgeOk = loadEdgeTpuApi(runtimeRoot, &state.edgeTpu, &edgeDetail);
  state.tfLiteLoaded = tfLiteOk;
  state.edgeTpuLoaded = edgeOk;

  state.tpuDelegateReady = false;
  state.tpuInferenceActive = false;
  state.modelLoadable = false;
  state.modelPlaceholder = false;
  state.modelEdgeTpuCompiled = modelSpec.edgeTpuCompiled;
  if (tfLiteOk && edgeOk) {
    std::vector<std::pair<int, std::string>> discoveredDevices;
    if (state.edgeTpu.listDevices != nullptr && state.edgeTpu.freeDevices != nullptr) {
      size_t deviceCount = 0;
      EdgeTpuDeviceInfo* devices = state.edgeTpu.listDevices(&deviceCount);
      if (devices != nullptr) {
        discoveredDevices.reserve(deviceCount);
        for (size_t i = 0; i < deviceCount; ++i) {
          const std::string devicePath = devices[i].path == nullptr ? "" : devices[i].path;
          discoveredDevices.emplace_back(devices[i].type, devicePath);
        }
        state.edgeTpu.freeDevices(devices);
      }
    }

    int delegateType = -1;
    std::string delegatePath;
    for (const auto& candidate : discoveredDevices) {
      if (tryCreateAndReleaseDelegate(state.edgeTpu, candidate.first, candidate.second)) {
        delegateType = candidate.first;
        delegatePath = candidate.second;
        break;
      }
    }

    if (delegateType < 0 && tryCreateAndReleaseDelegate(state.edgeTpu, kEdgeTpuApexUsb, "")) {
      delegateType = kEdgeTpuApexUsb;
    }

    if (delegateType < 0 && tryCreateAndReleaseDelegate(state.edgeTpu, kEdgeTpuApexPci, "")) {
      delegateType = kEdgeTpuApexPci;
    }

    if (delegateType >= 0) {
      state.tpuDelegateReady = true;
      state.activeDelegateType = delegateType;
      state.activeDelegatePath = delegatePath;
      state.detail =
        tfLiteDetail + "; " + edgeDetail + "; delegate init ok; delegateType=" +
        delegateTypeToText(delegateType);
      if (!delegatePath.empty()) {
        state.detail += "; delegatePath='" + delegatePath + "'";
      }
      appendDiscoveredDeviceList(discoveredDevices, &state.detail);
    } else {
      state.detail = tfLiteDetail + "; " + edgeDetail + "; delegate init failed";
      appendDiscoveredDeviceList(discoveredDevices, &state.detail);
    }
  } else {
    state.detail = tfLiteDetail + "; " + edgeDetail;
  }

  if (tfLiteOk && !modelPath.empty()) {
    if (isLikelyPlaceholderModel(modelPath)) {
      state.modelPlaceholder = true;
      state.modelLoadable = false;
      state.detail += "; model placeholder detected";
    } else {
      TfLiteModel* model = state.tfLite.modelCreateFromFile(modelPath.c_str());
      if (model != nullptr) {
        state.modelLoadable = true;
        state.tfLite.modelDelete(model);
        state.detail += "; model load ok";
      } else {
        state.modelLoadable = false;
        state.detail += "; model load failed";
      }
    }
  }

  if (tfLiteOk && state.modelLoadable) {
    state.detail += std::string("; edgeTpuCompiled=") + (state.modelEdgeTpuCompiled ? "yes" : "no");
    if (state.tpuDelegateReady && state.modelEdgeTpuCompiled) {
      std::string probeDetail;
      state.tpuInferenceActive = probeTpuInference(state, modelPath, modelSpec, &probeDetail);
      state.detail += "; " + probeDetail;
    } else if (state.tpuDelegateReady && !state.modelEdgeTpuCompiled) {
      state.detail += "; edge tpu compile pending";
    }
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
  out << "\"tfliteRuntimeLoaded\":" << (state.tfLiteLoaded ? "true" : "false") << ",";
  out << "\"modelLoadable\":" << (state.modelLoadable ? "true" : "false") << ",";
  out << "\"modelPlaceholder\":" << (state.modelPlaceholder ? "true" : "false") << ",";
  out << "\"tpuInferenceActive\":" << (state.tpuInferenceActive ? "true" : "false") << ",";
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
  const ModelRuntimeSpec modelSpec = loadModelRuntimeSpec(req.modelPath);
  const auto features = buildFeatureVector(req);

  AdapterState state = buildAdapterState(req.modelPath);
  ClassificationResult result;
  std::string tpuError;
  if (runTpuInference(state, req, features, modelSpec, &result, &tpuError)) {
    if (result.reason.empty()) {
      result.reason = "tpu-inference";
    }
  } else {
    std::string localTfliteError;
    if (runLocalTfliteInference(state, req, features, modelSpec, &result, &localTfliteError)) {
      if (!tpuError.empty()) {
        result.reason += ";tpuFallback=" + tpuError;
      }
    } else {
      result = classifyHeuristic(req, profile);
      if (!tpuError.empty()) {
        result.reason += ";tpuFallback=" + tpuError;
      }
      if (!localTfliteError.empty()) {
        result.reason += ";tfliteFallback=" + localTfliteError;
      }
    }
  }

  std::cout << toJson(result);
  cleanupAdapterState(&state);
  return 0;
}
