import React from 'react';
import { writeFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
const svg = renderToStaticMarkup(<QRCodeSVG value="https://thermal-reserve.vercel.app/home" size={512} level="M" marginSize={4} title="Join the Thermal Reserve household demo" />);
await writeFile('apps/web/public/household-join.svg', svg + '\n');
console.log('Exported apps/web/public/household-join.svg');
