import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useConnection } from '../lib/stdb';

export function householdUrl(origin: string, database?: string, configuredDatabase?: string) {
  const url = new URL('/home', origin);
  if (database && database !== configuredDatabase) url.searchParams.set('db', database);
  return url.toString();
}
export function JoinQr() {
  const { database } = useConnection();
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => { setUrl(householdUrl(window.location.origin, database, import.meta.env.VITE_STDB_DB)); }, [database]);
  return <>
    <button className="join-qr-button" aria-label="Enlarge household join QR code" onClick={() => dialog.current?.showModal()}>
      {url && <QRCodeSVG value={url} size={48} marginSize={4} level="M" title="Join the household demo" />}
      <span>Join a home</span>
    </button>
    <dialog className="join-qr-dialog" ref={dialog} aria-labelledby="join-qr-title">
      <h2 id="join-qr-title">Join an Anchorage home</h2><p>Scan with your phone to try the household demo.</p>
      {url && <QRCodeSVG value={url} size={256} marginSize={4} level="M" title="Household demo join link" />}
      <a href={url}>{url}</a>
      <button onClick={() => dialog.current?.close()}>Close</button>
    </dialog>
  </>;
}
