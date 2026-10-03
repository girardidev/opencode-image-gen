export const TOOL_NAME = "generate_image"

export const DESCRIPTION = `Generate or edit an image with GPT image generation, billed to the user's ChatGPT Plus/Pro subscription, and save it to a file.

- Choose outputPath yourself (relative to the project directory unless absolute). The extension decides the format: .png, .webp, .jpg/.jpeg.
- Pass inputImages (local paths) to edit an existing image or use references. To revise a previous result, pass that file as an input image.
- One image per call. Call again for variants.
- Existing files are not replaced unless overwrite is true.`

export const FIELD_DESCRIPTIONS = {
  prompt: "Detailed description of the image to generate, or of the edit to apply to inputImages.",
  outputPath: "Where to save the image, e.g. assets/hero.png. Relative paths resolve against the project directory.",
  inputImages: "Local image paths (png, jpeg, webp, gif) to edit or use as references.",
  size: 'Image size: "auto" (default) or WIDTHxHEIGHT such as 1024x1024, 1536x1024 (landscape), 1024x1536 (portrait).',
  quality: "Rendering quality. Defaults to auto.",
  background: "Background. transparent requires png or webp. Defaults to auto.",
  format: "Output format. Defaults to the outputPath extension, otherwise png.",
  overwrite: "Replace outputPath if it already exists. Defaults to false.",
} as const
