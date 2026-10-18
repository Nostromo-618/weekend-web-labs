/** Explicit metadata refresh. Never invoked by a build or page visit. */
import fs from 'node:fs/promises';
import { MODEL_OPTIONS } from '@wwl/wwl-ai-chat';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';

const manifests = {};
const repos = new Map();
for (const model of MODEL_OPTIONS) {
  const record = prebuiltAppConfig.model_list.find((r) => r.model_id === model.id);
  const repo =
    model.repo || (model.modelUrl || record?.model)?.match(/huggingface.co\/([^/]+\/[^/]+)/)?.[1];
  if (!repo) continue;
  if (!repos.has(repo)) {
    const response = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`);
    if (!response.ok) throw new Error(`${repo}: HTTP ${response.status}`);
    repos.set(repo, await response.json());
  }
  const metadata = repos.get(repo);
  if (!/^[a-f0-9]{40}$/.test(metadata.sha)) throw new Error(`Missing revision: ${repo}`);
  const files = metadata.siblings
    .filter(({ rfilename: file }) => {
      if (model.backend === 'litert') return file === model.modelFile;
      if (file.includes('vision_encoder')) return false;
      if (model.backend === 'transformers')
        return (
          file.startsWith(`onnx/model_${model.precision}.onnx`) ||
          /^(config|generation_config|tokenizer|tokenizer_config|special_tokens_map|added_tokens)\.json$/.test(
            file,
          ) ||
          file === 'chat_template.jinja'
        );
      return /^(params_shard_\d+\.bin|ndarray-cache\.json|tensor-cache\.json|mlc-chat-config\.json|tokenizer.*|merges\.txt|vocab\.json)$/.test(
        file,
      );
    })
    .map((file) => ({
      path: file.rfilename,
      bytes: file.size,
      ...(file.lfs?.sha256 ? { sha256: file.lfs.sha256 } : { gitSha1: file.blobId }),
    }));
  if (!files.length || files.some((f) => !Number.isFinite(f.bytes) || (!f.sha256 && !f.gitSha1)))
    throw new Error(`Incomplete manifest: ${model.id}`);
  const manifest = {
    repo,
    revision: metadata.sha,
    artifacts: files,
    approxBytes: files.reduce((n, f) => n + f.bytes, 0),
    license: metadata.cardData?.license_name || metadata.cardData?.license || model.license,
  };
  if (model.backend === 'litert')
    manifest.modelUrl = `https://huggingface.co/${repo}/resolve/${metadata.sha}/${model.modelFile}`;
  if (model.backend === 'webllm') {
    manifest.modelUrl = `https://huggingface.co/${repo}/resolve/${metadata.sha}/`;
    manifest.modelLibUrl = record?.model_lib || model.modelLibUrl;
  }
  manifests[model.id] = manifest;
  console.log(`${model.id}: ${files.length} files, ${(manifest.approxBytes / 1e6).toFixed(1)} MB`);
}
const target = new URL('../../wwl-ai-chat/src/model-artifacts.json', import.meta.url);
await fs.writeFile(new URL(target.href + '.tmp'), JSON.stringify(manifests, null, 2) + '\n');
await fs.rename(new URL(target.href + '.tmp'), target);
