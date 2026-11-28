import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import iced from 'iced-x86';
import {Image} from '../tools/xdvdfs.mjs';
import {inspectXbe} from '../tools/xbe.mjs';
import {selectBuild,supportedBuilds} from '../tools/supported-builds.mjs';
import {flatTables} from '../tools/prepare-native.mjs';

const folder=process.env.HEROES_TEST_ISOS;
test('all supplied regions retain the reviewed hook instructions and SDK entry layouts',{skip:!folder},()=>{
  const config=JSON.parse(readFileSync(new URL('../config/supported-build.json',import.meta.url)));
  const images=new Map();
  for(const name of readdirSync(folder).filter(name=>/\.iso$/i.test(name))) {
    const image=new Image(join(folder,name));
    try {
      const file=image.files().find(f=>f.path.toLowerCase()==='default.xbe');
      const bytes=image.read(file.offset,file.size),layout=inspectXbe(bytes);
      const profile=selectBuild(config,layout.sha256,layout.titleId);
      images.set(profile.id,{bytes,layout});
    } finally {image.close();}
  }
  for(const profile of supportedBuilds(config))assert.ok(images.has(profile.id),'Missing '+profile.id);
  const addresses=JSON.parse(readFileSync(new URL('../native/config/pal-addresses.json',import.meta.url))).addresses;
  const usa=images.get('usa');
  const sdk=flatTables(readFileSync(new URL('../native/config/heroes-usa.toml',import.meta.url),'utf8'));
  const codePairs=Object.entries(addresses).map(([a,b])=>[Number(a),b]).filter(([a])=>a<0x240000);
  for(const address of Object.values(sdk.symbols))if(address>=0x240000)codePairs.push([address,address+0x140]);
  function offset(image,address) {
    const s=image.layout.sections.find(s=>address>=s.address&&address<s.address+s.fileSize);
    assert.ok(s,'Address outside stored section: '+address.toString(16));
    return s.fileOffset+address-s.address;
  }
  for(const [region,pal] of images)if(region!=='usa')for(const [a,b] of codePairs) {
    const at=offset(usa,a),bt=offset(pal,b);
    const decoder=new iced.Decoder(32,usa.bytes.subarray(at,at+256),iced.DecoderOptions.None);
    try {
      let pos=0;
      for(let n=0;n<12;n++) {
        const i=decoder.decode(),c=decoder.getConstantOffsets(i);
        try {
          assert.ok(!i.isInvalid);
          const mask=Array(i.length).fill(true);
          for(const [o,s] of [[c.displacementOffset,c.displacementSize],[c.immediateOffset,c.immediateSize]])
            if(s===4||i.flowControl===iced.FlowControl.ConditionalBranch||i.flowControl===iced.FlowControl.UnconditionalBranch)
              for(let j=0;j<s;j++)mask[o+j]=false;
          for(let j=0;j<i.length;j++)if(mask[j])assert.equal(pal.bytes[bt+pos+j],usa.bytes[at+pos+j],region+' at '+a.toString(16));
          pos+=i.length;
        } finally {c.free();i.free();}
      }
    } finally {decoder.free();}
  }
});
