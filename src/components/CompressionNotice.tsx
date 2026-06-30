import { useI18n } from "../i18n";

interface CompressionNoticeProps {
  chars: number;
  compressing: boolean;
  onCompress: () => Promise<void> | void;
  onIgnore: () => void;
}

export default function CompressionNotice({ chars, compressing, onCompress, onIgnore }: CompressionNoticeProps) {
  const { t } = useI18n();

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-3 text-sm text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{t("notice.longContext", { chars: chars.toLocaleString() })}</span>
        <div className="flex gap-2">
          <button
            onClick={() => void onCompress()}
            disabled={compressing}
            className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-[#1f2937] hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {compressing ? t("chat.compressing") : t("notice.compressNow")}
          </button>
          <button
            onClick={onIgnore}
            disabled={compressing}
            className="rounded-md border border-amber-300/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-300/10 disabled:opacity-60"
          >
            {t("notice.ignore")}
          </button>
        </div>
      </div>
    </div>
  );
}
