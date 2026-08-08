import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * VoiceCore(radial)のデザイントークン。jarvis-ui radial.html から継承した配色・フォント。
 *
 * 色は意図的に Chakra のカラートークン(theme.tokens.colors)には登録しない: Chakra既定の
 * プリセットには "teal" 等が {50..950} のパレットとして既に定義されており、同名のフラットな
 * 単色トークンを重ねると解決順序が曖昧になる。代わりにこの PALETTE を唯一の情報源とし、
 * 各コンポーネントで `color={PALETTE.teal}` のように生の値を直接渡す。
 * フォントはキー名の衝突が実害を生まない(単純な上書き)ため、Chakraのテーマトークンとして登録する。
 */
export const PALETTE = {
  void: "#04060b",
  hairline: "rgba(205, 227, 235, 0.14)",
  hairlineStrong: "rgba(205, 227, 235, 0.32)",
  teal: "#7fe0d0",
  indigo: "#7d89e8",
  violet: "#9c7fe0",
  gold: "#e7c383",
  red: "#e88a7d",
  ice: "#dce8ee",
  dim: "rgba(216, 230, 236, 0.7)",
  faint: "rgba(216, 230, 236, 0.42)",
} as const;

export const FONTS = {
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Hiragino Kaku Gothic ProN", "Yu Gothic", monospace',
  serif: '"Iowan Old Style", "Palatino Linotype", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif',
  sans: '-apple-system, "Hiragino Sans", "Yu Gothic", "Segoe UI", sans-serif',
} as const;

const config = defineConfig({
  cssVarsPrefix: "vc",
  theme: {
    tokens: {
      fonts: {
        mono: { value: FONTS.mono },
        serif: { value: FONTS.serif },
        sans: { value: FONTS.sans },
      },
    },
  },
  globalCss: {
    "html, body": { backgroundColor: PALETTE.void, color: PALETTE.ice },
  },
});

export const radialSystem = createSystem(defaultConfig, config);
