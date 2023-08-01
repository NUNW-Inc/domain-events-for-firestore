import * as http from "http";
import { URL } from "url";

export async function resetFirestore(projectId: string): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const uri = new URL(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`
  );

  return new Promise((resolve, reject) => {
    const content = "{}";

    const options = {
      hostname: uri.hostname,
      port: uri.port,
      path: uri.pathname,
      method: "DELETE",
      timeout: 3000,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(content),
      },
    };

    const req = http.request(options, (res) => {
      const statusCode = res.statusCode;

      if (!statusCode) {
        reject(new Error("statusCode=unknown"));
      } else if (statusCode < 200 || statusCode >= 300) {
        reject(new Error("statusCode=" + statusCode));
      } else {
        resolve();
      }
      res.destroy();
    });

    req.on("error", (err: Error) => {
      reject(err);
    });

    req.write(content);
    req.end();
  });
}
