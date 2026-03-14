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
