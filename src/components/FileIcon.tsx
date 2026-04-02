import {
  resolveFileIcon,
  toSetiGlyph,
} from "@/extensions/theme-seti/file-icons";
import { Settings as SettingsIcon } from "lucide-react";

export function FileIcon({
  fileName,
  className,
}: {
  fileName: string;
  className?: string;
}) {
  if (fileName === "Settings") {
    return (
      <SettingsIcon
        className={`h-4 w-4 shrink-0 text-foreground/50 ${className ?? ""}`.trim()}
      />
    );
  }

  const icon = resolveFileIcon(fileName, false);
  if (!icon) {
    return null;
  }

  const glyph = toSetiGlyph(icon.character);
  if (!glyph) {
    return null;
  }

  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${className ?? ""}`.trim()}
      style={{
        fontFamily: "seti",
        fontSize: "16px",
        color: icon.color,
        lineHeight: 1,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {glyph}
    </span>
  );
}
