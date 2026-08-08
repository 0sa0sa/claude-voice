import { useEffect, useRef, useState } from "react";
import { Box, Button, HStack, IconButton, Text } from "@chakra-ui/react";
import type { ChatMessage } from "../hooks/useChat";
import { PALETTE } from "./theme";

const ROLE_PREFIX: Record<ChatMessage["role"], string> = {
  user: ">",
  assistant: "«",
  interjection: "«",
  system: "⚙",
};
const ROLE_COLOR: Record<ChatMessage["role"], string> = {
  user: PALETTE.teal,
  assistant: PALETTE.indigo,
  interjection: PALETTE.gold,
  system: PALETTE.gold,
};

const LONG_TEXT_THRESHOLD = 220;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <IconButton
      aria-label={copied ? "コピーしました" : "本文をコピー"}
      title={copied ? "コピーしました" : "コピー"}
      size="2xs"
      variant="ghost"
      color={copied ? PALETTE.teal : PALETTE.faint}
      opacity={0}
      _groupHover={{ opacity: 1 }}
      minW="18px"
      h="18px"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? "✓" : "⧉"}
    </IconButton>
  );
}

/** 1行分。長い本文は既定で折りたたみ、「もっと見る」で展開する(UI/UX②)。 */
function LogLine({ msg }: { msg: ChatMessage }) {
  const isLong = msg.text.length > LONG_TEXT_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const showFull = expanded || !isLong;
  const shown = showFull ? msg.text : msg.text.slice(0, LONG_TEXT_THRESHOLD).trimEnd() + "…";

  return (
    <HStack
      role="group"
      align="flex-start"
      gap="10px"
      mt="9px"
      fontSize="13px"
      lineHeight="1.7"
      css={{ animation: "vc-line-in 0.4s ease both" }}
    >
      <Text as="span" fontFamily="mono" fontSize="11px" flex="none" pt="2px" color={ROLE_COLOR[msg.role]}>
        {ROLE_PREFIX[msg.role]}
      </Text>
      <Box flex="1" minW="0">
        <Text
          as="span"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          color={msg.role === "system" ? PALETTE.faint : msg.role === "user" ? PALETTE.dim : PALETTE.ice}
          fontFamily={msg.role === "system" ? "mono" : "sans"}
          fontSize={msg.role === "system" ? "11px" : "13px"}
          letterSpacing={msg.role === "system" ? "0.04em" : undefined}
        >
          {shown || (msg.streaming ? "…" : "")}
          {msg.streaming && (
            <Box
              as="span"
              display="inline-block"
              w="6px"
              h="6px"
              ml="4px"
              borderRadius="full"
              bg={PALETTE.teal}
              css={{ animation: "vc-blink 1.1s infinite" }}
              aria-label="応答中"
            />
          )}
        </Text>
        {isLong && (
          <Button
            variant="plain"
            size="2xs"
            display="block"
            mt="2px"
            px="0"
            h="auto"
            minW="0"
            color={PALETTE.faint}
            _hover={{ color: PALETTE.teal }}
            fontFamily="mono"
            fontSize="10px"
            letterSpacing="0.08em"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "たたむ" : "もっと見る"}
          </Button>
        )}
      </Box>
      {!msg.streaming && msg.text && <CopyButton text={msg.text} />}
    </HStack>
  );
}

/**
 * 会話ログ(UI/UX②): コンソール入力欄の上に重ねて表示し、上端はフェードで消える。
 * 長文の折りたたみ・ストリーミング表示・コピーボタン(ホバー時)を備える。
 */
export function ConsoleLog({ messages }: { messages: ChatMessage[] }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (messages.length !== prevCountRef.current) {
      el.scrollTop = el.scrollHeight;
      prevCountRef.current = messages.length;
    } else {
      // ストリーミング中の本文伸長でも追従スクロール
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const recent = messages.slice(-40);

  return (
    <Box
      ref={boxRef}
      maxH="176px"
      overflowY="auto"
      mb="14px"
      pr="4px"
      css={{
        maskImage: "linear-gradient(to bottom, transparent, #000 22%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 22%)",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        "@keyframes vc-line-in": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "none" } },
        "@keyframes vc-blink": { "50%": { opacity: 0.25 } },
      }}
    >
      {recent.map((m) => (
        <LogLine key={m.id} msg={m} />
      ))}
    </Box>
  );
}
