// Holt die vom Server präsentierte Zertifikatskette und speichert sie in ca-bundle.pem.
// Hinweis: Server senden häufig KEIN Root-Zertifikat! Für Firmen-Roots ggf. separat bereitstellen.
import tls from "tls";
import fs from "fs";
import path from "path";

const host = "feuerwehr.einsatz.or.at";
const port = 443;
const caFile = path.resolve("ca-bundle.pem");

const socket = tls.connect(
  { host, port, rejectUnauthorized: false },
  () => {
    const peer = socket.getPeerCertificate(true);
    if (!peer || !peer.raw) {
      console.error("[ERROR] Keine Zertifikate empfangen");
      process.exit(1);
    }

    let current = peer;
    const certs = [];
    const seen = new Set();

    while (current && current.raw) {
      const fp = current.fingerprint256 || current.fingerprint || "";
      if (fp && seen.has(fp)) break;
      if (fp) seen.add(fp);

      const pem = [
        "-----BEGIN CERTIFICATE-----",
        current.raw.toString("base64").match(/.{1,64}/g).join("\n"),
        "-----END CERTIFICATE-----",
        ""
      ].join("\n");

      certs.push(pem);

      if (!current.issuerCertificate || current.issuerCertificate === current) break;
      current = current.issuerCertificate;
    }

    fs.writeFileSync(caFile, certs.join("\n"), "utf8");
    console.log("[INFO] CA-Bundle gespeichert:", caFile);
    socket.end();
  }
);

socket.on("error", (e) => {
  console.error("[ERROR]", e.message);
  process.exit(1);
});
