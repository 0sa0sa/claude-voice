import { useMemo, useState } from "react";
import { Box, Input, Text, VStack } from "@chakra-ui/react";
import type { RadialProject } from "./useVoiceCoreData";
import { PALETTE } from "./theme";
import { Panel } from "./Panel";

export interface ProjectsListProps {
  projects: RadialProject[];
  activeProject: string | null;
  onSelect: (name: string) => void;
}

/** プロジェクト一覧の中身だけ(固定パネル/モバイルDrawerの両方から使う)。 */
export function ProjectsList({ projects, activeProject, onSelect }: ProjectsListProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <>
      {projects.length > 6 && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="検索…"
          size="2xs"
          mb="8px"
          bg="rgba(2,8,18,0.6)"
          border="1px solid"
          borderColor={PALETTE.hairline}
          color={PALETTE.ice}
          fontFamily="sans"
          _placeholder={{ color: PALETTE.faint }}
          _focus={{ borderColor: "rgba(127,224,208,0.5)", outline: "none" }}
        />
      )}
      {filtered.length === 0 ? (
        <Text fontSize="10px" color={PALETTE.faint} fontFamily="mono">
          {projects.length === 0 ? "NO PROJECTS" : "一致なし"}
        </Text>
      ) : (
        <VStack align="stretch" gap="1px">
          {filtered.map((p) => {
            const active = p.name === activeProject;
            const dotColor = p.running > 0 ? PALETTE.gold : active ? PALETTE.teal : PALETTE.faint;
            return (
              <Box
                as="button"
                key={p.name}
                display="flex"
                alignItems="center"
                gap="8px"
                w="100%"
                textAlign="left"
                bg="transparent"
                border="none"
                px="2px"
                py="5px"
                cursor="pointer"
                fontFamily="mono"
                fontSize="10px"
                letterSpacing="0.06em"
                color={active ? PALETTE.teal : PALETTE.dim}
                _hover={{ color: PALETTE.ice }}
                onClick={() => onSelect(p.name)}
              >
                <Box
                  w="5px"
                  h="5px"
                  borderRadius="full"
                  flex="none"
                  bg={dotColor}
                  css={p.running > 0 ? { boxShadow: `0 0 6px ${PALETTE.gold}`, animation: "vc-blink 1.6s infinite" } : undefined}
                />
                <Text as="span" flex="1" minW="0" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {p.name}
                </Text>
                <Text as="span" color={PALETTE.faint} fontSize="9px">
                  {p.running > 0 ? `RUN ${p.running}` : p.total ? `${p.done}/${p.total}` : ""}
                </Text>
              </Box>
            );
          })}
        </VStack>
      )}
    </>
  );
}

export interface ProjectsPanelProps extends ProjectsListProps {
  flashKey: number;
}

/** 左上に固定表示するプロジェクト一覧(デスクトップ)。狭幅では非表示(→MobileNavのDrawerで代替)。 */
export function ProjectsPanel({ flashKey, ...listProps }: ProjectsPanelProps) {
  return (
    <Panel
      id="panel-projects"
      flashKey={flashKey}
      position="fixed"
      left="26px"
      top="96px"
      w="216px"
      maxH="calc(100vh - 140px)"
      display={{ base: "none", md: "block" }}
      overflowY="auto"
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      <Text fontFamily="mono" fontSize="9px" letterSpacing="0.3em" color={PALETTE.faint} mb="8px">
        PROJECTS
      </Text>
      <ProjectsList {...listProps} />
    </Panel>
  );
}
