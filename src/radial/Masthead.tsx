import { Text } from "@chakra-ui/react";
import { PALETTE } from "./theme";

export interface MastheadProps {
  sysLine: string;
  status: string;
  statusActive: boolean;
}

/** 中央上部の題字。jarvis-ui radial.html の masthead をそのまま踏襲。 */
export function Masthead({ sysLine, status, statusActive }: MastheadProps) {
  return (
    <header style={{ textAlign: "center", marginTop: 4 }}>
      <Text fontFamily="mono" fontSize="10px" letterSpacing="0.32em" color={PALETTE.faint} textTransform="uppercase" mb="14px">
        {sysLine}
      </Text>
      <Text
        as="h1"
        fontFamily="serif"
        fontWeight="400"
        fontSize={{ base: "26px", md: "clamp(28px, 4vw, 40px)" }}
        letterSpacing="0.01em"
        color={PALETTE.ice}
        css={{ textShadow: "0 0 22px rgba(127, 224, 208, 0.25)" }}
        m="0"
      >
        claude-voice
      </Text>
      <Text
        mt="10px"
        fontFamily="mono"
        fontSize="10px"
        letterSpacing="0.42em"
        textTransform="uppercase"
        color={statusActive ? PALETTE.gold : PALETTE.faint}
        css={statusActive ? { textShadow: "0 0 12px rgba(231, 195, 131, 0.6)" } : undefined}
        transition="color 0.4s ease, text-shadow 0.4s ease"
      >
        {status}
      </Text>
    </header>
  );
}
