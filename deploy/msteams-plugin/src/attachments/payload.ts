// Stub: buildMediaPayload was added to plugin-sdk after this plugin version.
function buildMediaPayload(
  mediaList: Array<{ path: string; contentType?: string }>,
  _opts?: { preserveMediaTypeCardinality?: boolean },
): Record<string, unknown> {
  const paths = mediaList.map((m) => m.path);
  const types = mediaList.map((m) => m.contentType ?? "application/octet-stream");
  if (paths.length === 1) {
    return { MediaPath: paths[0], MediaType: types[0], MediaUrl: paths[0] };
  }
  return { MediaPaths: paths, MediaTypes: types, MediaUrls: paths };
}

export function buildMSTeamsMediaPayload(
  mediaList: Array<{ path: string; contentType?: string }>,
): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
} {
  return buildMediaPayload(mediaList, { preserveMediaTypeCardinality: true });
}
