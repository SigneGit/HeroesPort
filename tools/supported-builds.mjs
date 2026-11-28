// Keep the original USA profile shape compatible with existing integrations.
export function supportedBuilds(config) {
  const {variants=[],...primary}=config;
  return [primary,...variants];
}
export function selectBuild(config,sha256,titleId) {
  const profile=supportedBuilds(config).find(p=>p.xbeSha256===sha256&&
    (titleId===undefined||p.titleId===titleId));
  if(!profile)throw Error('Unsupported executable build. Select a supported, unmodified Heroes Xbox game.');
  return profile;
}
