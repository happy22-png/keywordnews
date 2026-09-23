const crypto = require('node:crypto');
const NAME = '__Host-keywordnews';
const TTL = 7 * 24 * 3600;
function secret() {
  const key = Buffer.from(process.env.COOKIE_SECRET || '', 'base64');
  if (key.length !== 32) throw new Error('서버의 COOKIE_SECRET 설정이 필요합니다.');
  return key;
}
function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  cipher.setAAD(Buffer.from(NAME));
  const content = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64url');
}
function read(req) {
  secret(); // Fail closed if the deployment is not configured.
  try {
    const value = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(NAME+'='))?.slice(NAME.length+1);
    if (!value || value.length > 3500) return null;
    const raw = Buffer.from(value, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secret(), raw.subarray(0,12));
    decipher.setAAD(Buffer.from(NAME));
    decipher.setAuthTag(raw.subarray(12,28));
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]));
    return data.exp > Date.now() && data.v === 1 ? data : null;
  } catch { return null; }
}
function write(res, data) {
  const value = seal(data);
  if (value.length > 3500) throw new Error('저장할 키가 너무 깁니다.');
  const age = Math.max(0, Math.floor((data.exp-Date.now())/1000));
  res.setHeader('Set-Cookie', `${NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);
}
function clear(res) { res.setHeader('Set-Cookie', `${NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`); }
function publicState(data) {
  return {gemini:!!data?.keys.gemini, openai:!!data?.keys.openai, preferred:data?.preferred || 'gemini', expiresAt:data?.exp || null};
}
function send(res, status, data) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.statusCode=status; res.end(JSON.stringify(data));
}
function sameOrigin(req) {
  const expected = process.env.APP_ORIGIN || `https://${req.headers.host}`;
  return req.headers.origin === expected && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
}
function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('JSON 요청이 필요합니다.');
  const value = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 4096) throw new Error('요청 형식이 올바르지 않습니다.');
  return value;
}
module.exports={read,write,clear,publicState,send,sameOrigin,body,TTL};
