import { useEffect, useState } from "react";

export function useAppVersion() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    window.electronAPI?.app.getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  return version;
}
