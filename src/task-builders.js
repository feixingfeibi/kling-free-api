export function buildTextToVideoTask({
  prompt,
  negativePrompt = "",
  duration = "5",
  imageCount = "1",
  klingVersion = "3.0",
  aspectRatio = "16:9",
  modelMode = "std",
  cfg = "0.5",
  enableAudio = "true",
  richPrompt = "",
  preferMultiShots = "true",
} = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required");
  }

  return {
    type: "m2v_aio2video",
    arguments: [
      { name: "negative_prompt", value: String(negativePrompt) },
      { name: "duration", value: String(duration) },
      { name: "imageCount", value: String(imageCount) },
      { name: "kling_version", value: String(klingVersion) },
      { name: "prompt", value: String(prompt) },
      { name: "rich_prompt", value: String(richPrompt) },
      { name: "cfg", value: String(cfg) },
      { name: "aspect_ratio", value: String(aspectRatio) },
      {
        name: "camera_json",
        value:
          '{"type":"empty","horizontal":0,"vertical":0,"zoom":0,"tilt":0,"pan":0,"roll":0}',
      },
      { name: "camera_control_enabled", value: "false" },
      { name: "prefer_multi_shots", value: String(preferMultiShots) },
      { name: "biz", value: "klingai" },
      { name: "enable_audio", value: String(enableAudio) },
      { name: "model_mode", value: String(modelMode) },
    ],
    inputs: [],
  };
}

export function buildImageToVideoTask({
  imageUrl,
  prompt = "",
  negativePrompt = "",
  duration = "5",
  imageCount = "1",
  klingVersion = "3.0",
  aspectRatio = "16:9",
  modelMode = "std",
  cfg = "0.5",
  enableAudio = "true",
  richPrompt = "",
  preferMultiShots = "true",
  tailImageEnabled = "false",
  tailImageUrl = "",
} = {}) {
  if (!imageUrl || !String(imageUrl).trim()) {
    throw new Error("imageUrl is required");
  }

  const inputs = [
    {
      name: "input",
      inputType: "URL",
      url: String(imageUrl),
    },
  ];

  if (String(tailImageEnabled) === "true" && String(tailImageUrl).trim()) {
    inputs.push({
      name: "tail_image",
      inputType: "URL",
      url: String(tailImageUrl),
    });
  }

  return {
    type: "m2v_aio2video",
    arguments: [
      { name: "negative_prompt", value: String(negativePrompt) },
      { name: "duration", value: String(duration) },
      { name: "imageCount", value: String(imageCount) },
      { name: "kling_version", value: String(klingVersion) },
      { name: "prompt", value: String(prompt) },
      { name: "rich_prompt", value: String(richPrompt) },
      { name: "cfg", value: String(cfg) },
      { name: "aspect_ratio", value: String(aspectRatio) },
      {
        name: "camera_json",
        value:
          '{"type":"empty","horizontal":0,"vertical":0,"zoom":0,"tilt":0,"pan":0,"roll":0}',
      },
      { name: "camera_control_enabled", value: "false" },
      { name: "prefer_multi_shots", value: String(preferMultiShots) },
      { name: "biz", value: "klingai" },
      { name: "enable_audio", value: String(enableAudio) },
      { name: "model_mode", value: String(modelMode) },
      { name: "tail_image_enabled", value: String(tailImageEnabled) },
    ],
    inputs,
  };
}

export function buildFirstLastFrameVideoTask({
  imageUrl,
  tailImageUrl,
  prompt = "",
  negativePrompt = "",
  duration = "5",
  imageCount = "1",
  klingVersion = "3.0",
  aspectRatio = "16:9",
  modelMode = "std",
  cfg = "0.5",
  enableAudio = "true",
  richPrompt = "",
  preferMultiShots = "true",
} = {}) {
  if (!imageUrl || !String(imageUrl).trim()) {
    throw new Error("imageUrl is required");
  }
  if (!tailImageUrl || !String(tailImageUrl).trim()) {
    throw new Error("tailImageUrl is required");
  }

  return {
    type: "m2v_aio2video",
    arguments: [
      { name: "negative_prompt", value: String(negativePrompt) },
      { name: "duration", value: String(duration) },
      { name: "imageCount", value: String(imageCount) },
      { name: "kling_version", value: String(klingVersion) },
      { name: "prompt", value: String(prompt) },
      { name: "rich_prompt", value: String(richPrompt) },
      { name: "cfg", value: String(cfg) },
      { name: "aspect_ratio", value: String(aspectRatio) },
      {
        name: "camera_json",
        value:
          '{"type":"empty","horizontal":0,"vertical":0,"zoom":0,"tilt":0,"pan":0,"roll":0}',
      },
      { name: "camera_control_enabled", value: "false" },
      { name: "prefer_multi_shots", value: String(preferMultiShots) },
      { name: "biz", value: "klingai" },
      { name: "enable_audio", value: String(enableAudio) },
      { name: "model_mode", value: String(modelMode) },
      { name: "tail_image_enabled", value: "true" },
    ],
    inputs: [
      {
        name: "input",
        inputType: "URL",
        url: String(imageUrl),
      },
      {
        name: "tail_image",
        inputType: "URL",
        url: String(tailImageUrl),
      },
    ],
  };
}

export function buildOmniVideoRecognitionBody({
  inputs = [],
  prompt = "",
  richPrompt = "",
  skill = "",
  klingVersion = "3.0-omni",
  enableAudio = true,
  customizeMultiShots = false,
  preferMultiShots = "true",
  callbackPayloads,
} = {}) {
  return {
    type: "m2v_omni_video",
    inputs,
    arguments: [
      { name: "skill", value: String(skill) },
      { name: "biz", value: "klingai" },
      { name: "kling_version", value: String(klingVersion) },
      { name: "customize_multi_shots", value: customizeMultiShots },
      { name: "prefer_multi_shots", value: String(preferMultiShots) },
      { name: "prompt", value: String(prompt) },
      { name: "rich_prompt", value: String(richPrompt) },
      { name: "enable_audio", value: Boolean(enableAudio) },
    ],
    callbackPayloads:
      callbackPayloads || [
        { name: "settingKeys", value: "" },
        { name: "imageMasks", value: "", resources: [] },
        { name: "subjects", value: "[]" },
      ],
  };
}

export function buildOmniVideoTemplateBody({
  omniRecognition,
  taskInputs = [],
  taskArguments = [],
  version = "3.0",
} = {}) {
  return {
    type: "m2v_omni_video",
    version: String(version),
    omniRecognition: omniRecognition ? String(omniRecognition) : undefined,
    taskInputs,
    taskArguments,
  };
}

export function buildOmniVideoPriceBody({
  inputs = [],
  omniRecognition,
  prompt = "",
  richPrompt = "",
  skill = "",
  klingVersion = "3.0-omni",
  modelMode = "pro",
  duration = "5",
  aspectRatio = "16:9",
  imageCount = "1",
  creationEntrance = "base",
  enableAudio = true,
  customizeMultiShots = false,
  preferMultiShots = "true",
  settingKeys = "model_mode|duration|aspect_ratio|imageCount",
  callbackPayloads,
} = {}) {
  return {
    type: "m2v_omni_video",
    inputs,
    arguments: [
      { name: "skill", value: String(skill) },
      { name: "biz", value: "klingai" },
      { name: "kling_version", value: String(klingVersion) },
      { name: "model_mode", value: String(modelMode), setByUser: false },
      { name: "duration", value: String(duration), setByUser: false },
      { name: "aspect_ratio", value: String(aspectRatio), setByUser: false },
      { name: "imageCount", value: String(imageCount), setByUser: false },
      { name: "customize_multi_shots", value: customizeMultiShots },
      { name: "prefer_multi_shots", value: String(preferMultiShots) },
      { name: "prompt", value: String(prompt) },
      { name: "rich_prompt", value: String(richPrompt) },
      { name: "enable_audio", value: Boolean(enableAudio) },
      {
        name: "omniRecognition",
        value: omniRecognition ? String(omniRecognition) : "",
      },
      { name: "creationEntrance", value: String(creationEntrance) },
    ],
    callbackPayloads:
      callbackPayloads || [
        { name: "settingKeys", value: String(settingKeys) },
        { name: "imageMasks", value: "", resources: [] },
        { name: "subjects", value: "[]" },
      ],
  };
}

export function buildOmniVideoSubmitTask(options = {}) {
  return buildOmniVideoPriceBody(options);
}
