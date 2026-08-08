import { useEffect, useRef } from "react";
import { Box, HStack, Text, Textarea } from "@chakra-ui/react";
import { ConsoleLog } from "./ConsoleLog";
import { FONTS, PALETTE } from "./theme";
import type { ChatMessage } from "../hooks/useChat";

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
    />
  </svg>
);
const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
  </svg>
);
const SpeakerIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <path
      fill="currentColor"
      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-.77-3.29-2.5-4.03v8.05c1.73-.74 2.5-2.25 2.5-4.02z"
    />
  </svg>
);

function CtlButton({
  active,
  quiet,
  onClick,
  icon,
  label,
  activeLabel,
}: {
  active?: boolean;
  quiet?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  activeLabel?: string;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      display="inline-flex"
      alignItems="center"
      gap="7px"
      bg="none"
      border="none"
      py="6px"
      cursor="pointer"
      fontFamily="mono"
      fontSize={quiet ? "10px" : "11px"}
      letterSpacing="0.16em"
      color={active ? PALETTE.gold : quiet ? PALETTE.faint : PALETTE.dim}
      position="relative"
      _hover={{ color: active ? PALETTE.gold : PALETTE.ice }}
      css={{
        "&::after": {
          content: '""',
          position: "absolute",
          left: 0,
          right: active ? 0 : "100%",
          bottom: 0,
          height: "1px",
          background: active ? PALETTE.gold : PALETTE.teal,
          transition: "right 0.25s ease",
        },
        "&:hover::after": { right: 0 },
      }}
    >
      {icon}
      <Text as="span" opacity={0.9}>
        {active && activeLabel ? activeLabel : label}
      </Text>
    </Box>
  );
}

export interface ConsoleDockProps {
  messages: ChatMessage[];
  draft: string;
  setDraft: (v: string) => void;
  onSubmitDraft: () => void;
  interim: string;
  levelReadoutRef: React.RefObject<HTMLSpanElement | null>;
  waveCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  listening: boolean;
  supported: boolean;
  ttsEnabled: boolean;
  onToggleMic: () => void;
  onToggleTts: () => void;
  onStopAll: () => void;
}

/** 下部コンソール: 会話ログ・入力欄・オシロスコープ・操作ボタン群。 */
export function ConsoleDock({
  messages,
  draft,
  setDraft,
  onSubmitDraft,
  interim,
  levelReadoutRef,
  waveCanvasRef,
  listening,
  supported,
  ttsEnabled,
  onToggleMic,
  onToggleTts,
  onStopAll,
}: ConsoleDockProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <Box as="main" pointerEvents="auto" w={{ base: "94vw", md: "min(600px, 92vw)" }}>
      <ConsoleLog messages={messages} />

      <HStack align="flex-start" gap="10px" borderBottom="1px solid" borderColor={PALETTE.hairline} pb="10px">
        <Text fontFamily="mono" fontSize="14px" color={PALETTE.teal} lineHeight="1.6" opacity={0.8}>
          &gt;
        </Text>
        <Textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmitDraft();
            }
          }}
          placeholder="話しかけるか、指示を入力… (Enterで送信)"
          rows={1}
          resize="none"
          bg="transparent"
          border="none"
          color={PALETTE.ice}
          fontFamily="sans"
          fontSize="14px"
          lineHeight="1.6"
          p="0"
          minH="auto"
          overflow="hidden"
          _placeholder={{ color: PALETTE.faint }}
          _focus={{ outline: "none", boxShadow: "none" }}
        />
      </HStack>
      <Text fontFamily="sans" fontSize="13px" color={PALETTE.faint} fontStyle="italic" pt="4px" pl="24px" minH="0">
        {interim}
      </Text>

      <Box position="relative" mt="14px" h="40px" borderBottom="1px solid" borderColor={PALETTE.hairline}>
        <canvas ref={waveCanvasRef} style={{ display: "block", width: "100%", height: "40px" }} />
        {/* Chakraのポリモーフィックref型はas切替に追従しないため、素のspanで直接refを持つ */}
        <span
          ref={levelReadoutRef}
          style={{
            position: "absolute",
            right: 0,
            bottom: "6px",
            fontFamily: FONTS.mono,
            fontSize: "10px",
            letterSpacing: "0.14em",
            color: PALETTE.faint,
          }}
        >
          LVL 000
        </span>
      </Box>

      <HStack gap="22px" mt="16px" align="center" flexWrap="wrap">
        <CtlButton active={listening} onClick={onToggleMic} icon={<MicIcon />} label="マイク入力" activeLabel="聴音中…" />
        <CtlButton onClick={onSubmitDraft} icon={<SendIcon />} label="送信" />
        <CtlButton active={ttsEnabled} onClick={onToggleTts} icon={<SpeakerIcon />} label="読み上げ OFF" activeLabel="読み上げ ON" />
        <Box ml="auto">
          <CtlButton quiet onClick={onStopAll} label="停止" />
        </Box>
      </HStack>
      {!supported && (
        <Text mt="8px" fontFamily="mono" fontSize="10px" color={PALETTE.red}>
          このブラウザは音声認識非対応です(Chrome推奨)
        </Text>
      )}
    </Box>
  );
}
