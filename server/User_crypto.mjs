import crypto from "crypto";

function scryptAsync(password, salt, opts={N:16384,r:8,p:1}, keyLen=32){
  return new Promise((res, rej)=>{
    crypto.scrypt(password, salt, keyLen, opts, (err, dk)=> err?rej(err):res(dk));
  });
}

export async function User_deriveKey(password, saltB64){
  const salt = saltB64 ? Buffer.from(saltB64, "base64") : crypto.randomBytes(16);
  const key  = await scryptAsync(password, salt);
  return { key, salt: salt.toString("base64"), params:{N:16384,r:8,p:1} };
}

export function User_encryptJSON(obj, key){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v:1, iv:iv.toString("base64"), data:ct.toString("base64"), tag:tag.toString("base64") };
}

export function User_decryptJSON(payload, key){
  const {iv, data, tag} = payload;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv,"base64"));
  decipher.setAuthTag(Buffer.from(tag,"base64"));
  const dt = Buffer.concat([decipher.update(Buffer.from(data,"base64")), decipher.final()]);
  return JSON.parse(dt.toString("utf8"));
}

export function User_hmacVerifyBlob(key){
  const h = crypto.createHmac("sha256", key);
  h.update("User_Vault_OK");
  return h.digest("base64");
}

export async function User_hashPassword(password){
  const salt = crypto.randomBytes(16);
  const key  = await scryptAsync(password, salt);
  return { algo:"scrypt", salt:salt.toString("base64"), hash:Buffer.from(key).toString("base64") };
}
export async function User_verifyPassword(password, rec){
  const key = await scryptAsync(password, Buffer.from(rec.salt,"base64"));
  return Buffer.from(key).toString("base64") === rec.hash;
}
