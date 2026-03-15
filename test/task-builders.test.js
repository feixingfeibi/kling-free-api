import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFirstLastFrameVideoTask,
  buildImageToVideoTask,
  buildOmniImagePriceBody,
  buildOmniImageRecognitionBody,
  buildOmniImageSubmitTask,
  buildOmniImageTemplateBody,
  buildOmniVideoPriceBody,
  buildOmniVideoRecognitionBody,
  buildOmniVideoSubmitTask,
  buildTextToVideoTask,
} from "../src/task-builders.js";

function findArgument(task, name) {
  return task.arguments.find((item) => item.name === name);
}

test("buildTextToVideoTask requires prompt and maps fields", () => {
  assert.throws(() => buildTextToVideoTask({ prompt: "   " }), /prompt is required/);

  const task = buildTextToVideoTask({
    prompt: "cinematic street",
    duration: 10,
    aspectRatio: "9:16",
    enableAudio: false,
  });

  assert.equal(task.type, "m2v_aio2video");
  assert.deepEqual(task.inputs, []);
  assert.equal(findArgument(task, "prompt").value, "cinematic street");
  assert.equal(findArgument(task, "duration").value, "10");
  assert.equal(findArgument(task, "aspect_ratio").value, "9:16");
  assert.equal(findArgument(task, "enable_audio").value, "false");
});

test("buildImageToVideoTask requires imageUrl and appends tail image when enabled", () => {
  assert.throws(() => buildImageToVideoTask({ imageUrl: "" }), /imageUrl is required/);

  const task = buildImageToVideoTask({
    imageUrl: "https://example.com/input.png",
    tailImageEnabled: true,
    tailImageUrl: "https://example.com/tail.png",
  });

  assert.equal(task.inputs.length, 2);
  assert.deepEqual(task.inputs[0], {
    name: "input",
    inputType: "URL",
    url: "https://example.com/input.png",
  });
  assert.deepEqual(task.inputs[1], {
    name: "tail_image",
    inputType: "URL",
    url: "https://example.com/tail.png",
  });
  assert.equal(findArgument(task, "tail_image_enabled").value, "true");
});

test("buildFirstLastFrameVideoTask requires both images", () => {
  assert.throws(
    () => buildFirstLastFrameVideoTask({ imageUrl: "https://example.com/input.png" }),
    /tailImageUrl is required/
  );

  const task = buildFirstLastFrameVideoTask({
    imageUrl: "https://example.com/input.png",
    tailImageUrl: "https://example.com/tail.png",
  });

  assert.equal(task.inputs.length, 2);
  assert.equal(findArgument(task, "tail_image_enabled").value, "true");
});

test("buildOmniVideoRecognitionBody uses defaults and preserves custom callback payloads", () => {
  const withDefaults = buildOmniVideoRecognitionBody({
    inputs: [{ name: "image_1", inputType: "URL", url: "https://example.com/1.png" }],
    prompt: "make it cinematic",
  });

  assert.equal(withDefaults.type, "m2v_omni_video");
  assert.equal(withDefaults.callbackPayloads.length, 3);
  assert.equal(findArgument(withDefaults, "enable_audio").value, true);

  const callbackPayloads = [{ name: "subjects", value: "[1]" }];
  const custom = buildOmniVideoRecognitionBody({ callbackPayloads });
  assert.equal(custom.callbackPayloads, callbackPayloads);
});

test("buildOmniVideoPriceBody and submit alias produce the same payload", () => {
  const options = {
    inputs: [{ name: "image_1", inputType: "URL", url: "https://example.com/1.png" }],
    omniRecognition: "recognized-intent",
    modelMode: "std",
    duration: 10,
    aspectRatio: "1:1",
    enableAudio: false,
  };

  const price = buildOmniVideoPriceBody(options);
  const submit = buildOmniVideoSubmitTask(options);

  assert.deepEqual(submit, price);
  assert.equal(findArgument(price, "omniRecognition").value, "recognized-intent");
  assert.equal(findArgument(price, "duration").value, "10");
  assert.equal(findArgument(price, "aspect_ratio").value, "1:1");
  assert.equal(findArgument(price, "enable_audio").value, false);
});

test("buildOmniImageRecognitionBody and template body map omni image fields", () => {
  const recognition = buildOmniImageRecognitionBody({
    prompt: "post-apocalyptic girl portrait",
    kolorsVersion: "3.0-omni",
  });

  assert.equal(recognition.type, "mmu_omni_image");
  assert.equal(findArgument(recognition, "prompt").value, "post-apocalyptic girl portrait");
  assert.equal(findArgument(recognition, "kolors_version").value, "3.0-omni");

  const template = buildOmniImageTemplateBody({
    omniRecognition: "recognized-image-intent",
    storyMode: true,
  });

  assert.equal(template.type, "mmu_omni_image");
  assert.equal(findArgument(template, "story_mode").value, true);
  assert.equal(findArgument(template, "omniRecognition").value, "recognized-image-intent");
});

test("buildOmniImagePriceBody and submit alias produce the same payload", () => {
  const options = {
    inputs: [{ name: "image_1", inputType: "URL", url: "https://example.com/1.png" }],
    omniRecognition: "recognized-image-intent",
    aspectRatio: "3:2",
    imageCount: 2,
    imageResolution: "2k",
    storyMode: false,
  };

  const price = buildOmniImagePriceBody(options);
  const submit = buildOmniImageSubmitTask(options);

  assert.deepEqual(submit, price);
  assert.equal(price.type, "mmu_omni_image");
  assert.equal(findArgument(price, "aspect_ratio").value, "3:2");
  assert.equal(findArgument(price, "imageCount").value, "2");
  assert.equal(findArgument(price, "img_resolution").value, "2k");
  assert.equal(findArgument(price, "omniRecognition").value, "recognized-image-intent");
});
