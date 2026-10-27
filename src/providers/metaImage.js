export function createMetaImage({ client, model, env = process.env, costUsd } = {}) {
  if (!client?.meteredPost) throw new Error('createMetaImage needs a metered client');
  const imageModel = model ?? env.META_IMAGE_MODEL ?? 'muse-image-1.0';
  const rawCost = costUsd ?? (env.META_IMAGE_COST_USD?.trim() ? env.META_IMAGE_COST_USD : 0.01);
  const price = Number(rawCost);
  if (!Number.isFinite(price) || price < 0) throw new Error('META_IMAGE_COST_USD must be finite and nonnegative');
  return {
    async generate({ prompt, size = '1024x1024' } = {}) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Image prompt is required');
      if (typeof size !== 'string' || !/^\d+x\d+$/.test(size)) throw new Error('Image size must be WxH');
      const response = await client.meteredPost('/images/generations', {
        model: imageModel, prompt, n: 1, size, response_format: 'b64_json', output_format: 'png',
      }, { costUsd: price, label: 'image' });
      try {
        const encoded = response?.data?.[0]?.b64_json;
        if (typeof encoded !== 'string' || !encoded) throw new Error('Image response did not contain valid base64 image data');
        // Buffer's decoder is permissive; comparing its canonical encoding rejects
        // malformed input without a regex whose stack grows with image size.
        const buffer = Buffer.from(encoded, 'base64');
        if (buffer.toString('base64') !== encoded) throw new Error('Image response did not contain valid base64 image data');
        return { buffer, mime: 'image/png', costUsd: price };
      } catch (error) {
        // Available to a caller for diagnostic persistence, but omitted from
        // ordinary error inspection and JSON logging to avoid dumping image data.
        Object.defineProperty(error, 'rawResponse', { value: response, enumerable: false });
        throw error;
      }
    },
  };
}
