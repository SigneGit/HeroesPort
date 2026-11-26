import {existsSync,readFileSync,realpathSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root} from './game-image.mjs';

export function validateLauncherImport(directory=join(root,'local/game')) {
  const profile=JSON.parse(readFileSync(join(root,'config/supported-build.json')));
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json')));
  const digest=createHash('sha256').update(readFileSync(join(directory,'assets/default.xbe'))).digest('hex');
  if(digest!==profile.xbeSha256||manifest.executableSha256!==digest)
    throw Error('Imported executable does not match the supported USA game. Existing files were retained.');
  return manifest.files.length;
}

if(process.argv[1]?.endsWith('launcher-import.mjs')) {
  try {
    if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or newer is required.');
    const [iso,...extra]=process.argv.slice(2);
    if(!iso||extra.length)throw Error('Select your legally acquired game ISO.');
    // Validate the supplied image even when an import is already present.
    const inspect=spawnSync(process.execPath,[join(root,'tools/heroes.mjs'),'inspect',iso],{encoding:'utf8'});
    if(inspect.status!==0)throw Error(inspect.stderr||'Unable to inspect ISO.');
    const report=JSON.parse(inspect.stdout),profile=JSON.parse(readFileSync(join(root,'config/supported-build.json')));
    if(report.sha256!==profile.xbeSha256||report.titleId!==profile.titleId)throw Error('Unsupported ISO executable. The supported USA game is required.');
    if(!existsSync(join(root,'local/game'))) {
      console.log('Extracting verified game data. This may take a few minutes...');
      const run=spawnSync(process.execPath,[join(root,'tools/heroes.mjs'),'import',iso],{stdio:'inherit'});
      if(run.status!==0)throw Error('Import failed. See the extraction log.');
    }
    const count=validateLauncherImport();
    const assets=join(root,'native/assets'),source=join(root,'local/game/assets');
    if(!existsSync(assets))symlinkSync(source,assets,'junction');
    if(realpathSync(assets)!==realpathSync(source))throw Error('native/assets points to a different import. Existing files were retained.');
    console.log(`Imported and verified: ${count} files. Existing imports and saved games are preserved.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
