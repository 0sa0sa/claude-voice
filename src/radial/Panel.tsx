import { useEffect, useState } from "react";
import { Box } from "@chakra-ui/react";
import type { BoxProps } from "@chakra-ui/react";
import { PALETTE } from "./theme";

export interface PanelProps extends BoxProps {
  id?: string;
  /** この値が変わるたびに一瞬発光する(発話で言及された等の通知演出)。 */
  flashKey?: number;
}

/**
 * すりガラスのHUDパネル(jarvis-ui radial.html の `.tuner` を継承)。
 * PROJECTS/TASKS 両パネルの共通シェル。flashKey が変わると縁が一瞬発光する。
 */
export function Panel({ flashKey, children, ...rest }: PanelProps) {
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flashKey) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 950);
    return () => clearTimeout(t);
  }, [flashKey]);

  return (
    <Box
      zIndex={10}
      w="216px"
      px="14px"
      py="12px"
      bg="rgba(6, 16, 32, 0.55)"
      border="1px solid"
      borderColor={flashing ? PALETTE.teal : "rgba(93, 195, 255, 0.25)"}
      borderRadius="10px"
      backdropFilter="blur(10px)"
      fontFamily="mono"
      color={PALETTE.dim}
      boxShadow={flashing ? `0 0 20px rgba(127, 224, 208, 0.3)` : undefined}
      transition="border-color 0.3s ease, box-shadow 0.3s ease"
      css={{ "@keyframes vc-blink": { "50%": { opacity: 0.35 } } }}
      {...rest}
    >
      {children}
    </Box>
  );
}
