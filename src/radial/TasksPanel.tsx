import { useMemo, useState } from "react";
import { Badge, Box, Button, HStack, Input, Tabs, Text, VStack } from "@chakra-ui/react";
import type { RadialTask, TaskDetail } from "./useVoiceCoreData";
import { PALETTE } from "./theme";
import { Panel } from "./Panel";

const STATUS_JA: Record<RadialTask["status"], string> = {
  queued: "待機",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "中止",
};
const STATUS_MARK: Record<RadialTask["status"], string> = {
  queued: "◌",
  running: "●",
  succeeded: "✓",
  failed: "✕",
  cancelled: "⊘",
};
const STATUS_COLOR: Record<RadialTask["status"], string> = {
  queued: PALETTE.faint,
  running: PALETTE.gold,
  succeeded: PALETTE.teal,
  failed: PALETTE.red,
  cancelled: PALETTE.faint,
};

function timeAgo(ts?: number | null): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "たった今";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

type Filter = "all" | "running" | "review" | "done";

/** 実行中/待機中→中止、完了/失敗→引き継ぎ、で使うインライン入力フォーム。 */
function InlineForm({ placeholder, onSubmit }: { placeholder: string; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setValue("");
        onSubmit(v);
      }}
      placeholder={placeholder}
      autoFocus
      mt="6px"
      size="2xs"
      bg="rgba(2,8,18,0.6)"
      border="1px solid"
      borderColor={PALETTE.hairline}
      color={PALETTE.ice}
      fontFamily="sans"
      _placeholder={{ color: PALETTE.faint }}
      _focus={{ borderColor: "rgba(127,224,208,0.5)", outline: "none" }}
    />
  );
}

function ActionButton({ danger, onClick, children }: { danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      size="2xs"
      variant="outline"
      bg="transparent"
      border="1px solid"
      borderColor="rgba(93, 195, 255, 0.25)"
      borderRadius="5px"
      color={danger ? PALETTE.red : PALETTE.dim}
      fontFamily="mono"
      fontSize="9px"
      letterSpacing="0.1em"
      px="8px"
      _hover={{ color: danger ? PALETTE.red : PALETTE.teal, borderColor: danger ? PALETTE.red : PALETTE.teal }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

interface TaskRowProps {
  task: RadialTask;
  selected: boolean;
  review: boolean;
  detail?: TaskDetail;
  onToggle: () => void;
  onCancel: () => void;
  onInstruct: (text: string) => void;
  onResume: (text: string) => void;
}

function TaskRow({ task: t, selected, review, detail, onToggle, onCancel, onInstruct, onResume }: TaskRowProps) {
  const [formMode, setFormMode] = useState<"none" | "instruct" | "resume">("none");
  const out = t.status === "running" ? detail?.liveText || t.lastEvent || "実行中…" : t.result || t.error || "（出力はありません）";
  const tools = detail ? detail.events.filter((e) => e.kind === "tool").slice(-3) : [];

  return (
    <Box py="2px" cursor="pointer">
      <HStack
        role="button"
        tabIndex={0}
        align="baseline"
        gap="7px"
        px="2px"
        py="4px"
        fontFamily="mono"
        fontSize="10px"
        color={selected ? PALETTE.ice : PALETTE.dim}
        _hover={{ color: PALETTE.ice }}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <Text as="span" flex="none" w="10px" color={STATUS_COLOR[t.status]} css={t.status === "running" ? { animation: "vc-blink 1.4s infinite" } : undefined}>
          {STATUS_MARK[t.status]}
        </Text>
        <Text as="span" flex="none" color={PALETTE.faint}>
          #{t.seq}
        </Text>
        <Text as="span" flex="1" minW="0" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" fontFamily="sans" fontSize="11px">
          {t.instruction}
        </Text>
        {t.priority === "urgent" && (
          <Badge size="xs" variant="outline" color={PALETTE.gold} borderColor="rgba(231,195,131,0.5)" borderRadius="6px" fontSize="8px" px="4px">
            緊急
          </Badge>
        )}
        {review && (
          <Box w="5px" h="5px" borderRadius="full" bg={PALETTE.gold} flex="none" css={{ boxShadow: `0 0 6px ${PALETTE.gold}` }} title="要対応(未確認)" />
        )}
      </HStack>

      {selected && (
        <Box ml="17px" mt="2px" mb="8px" pt="7px" borderTop="1px dashed" borderColor={PALETTE.hairline}>
          <Text fontFamily="mono" fontSize="9px" color={PALETTE.faint} letterSpacing="0.04em" mb="5px">
            [{STATUS_JA[t.status]}]{t.priority === "urgent" ? " 緊急" : ""} {t.project} · {timeAgo(t.endedAt ?? t.startedAt)}
            {t.branch ? ` · ${t.branch}` : ""}
          </Text>
          <Text
            fontSize="11px"
            lineHeight="1.6"
            color={PALETTE.dim}
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            maxH="150px"
            overflowY="auto"
            mb="6px"
            css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
          >
            {out}
          </Text>
          {tools.length > 0 && (
            <VStack align="stretch" gap="2px" mb="6px">
              {tools.map((e, i) => (
                <Text key={i} fontFamily="mono" fontSize="9px" color={PALETTE.faint} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  ⚙ {e.text}
                </Text>
              ))}
            </VStack>
          )}
          <HStack gap="6px" flexWrap="wrap">
            {t.status === "running" && (
              <>
                <ActionButton onClick={() => setFormMode((m) => (m === "instruct" ? "none" : "instruct"))}>追加指示</ActionButton>
                <ActionButton danger onClick={onCancel}>
                  中止
                </ActionButton>
              </>
            )}
            {t.status === "queued" && (
              <ActionButton danger onClick={onCancel}>
                取り下げ
              </ActionButton>
            )}
            {(t.status === "succeeded" || t.status === "failed") && t.sessionId && (
              <ActionButton onClick={() => setFormMode((m) => (m === "resume" ? "none" : "resume"))}>引き継いで依頼</ActionButton>
            )}
          </HStack>
          {formMode === "instruct" && (
            <InlineForm
              placeholder="追加の指示… (Enter)"
              onSubmit={(v) => {
                onInstruct(v);
                setFormMode("none");
              }}
            />
          )}
          {formMode === "resume" && (
            <InlineForm
              placeholder="引き継いで何をしますか？ (Enter)"
              onSubmit={(v) => {
                onResume(v);
                setFormMode("none");
              }}
            />
          )}
        </Box>
      )}
    </Box>
  );
}

export interface TasksListProps {
  tasks: RadialTask[];
  selectedTaskId: string | null;
  detailsCache: Record<string, TaskDetail>;
  needsReview: (t: RadialTask) => boolean;
  onSelect: (id: string | null) => void;
  onAck: (id: string) => void;
  onCancel: (t: RadialTask) => void;
  onInstruct: (t: RadialTask, text: string) => void;
  onResume: (t: RadialTask, text: string) => void;
  onCreate: (text: string) => void;
}

const rank = (t: RadialTask) => (t.status === "running" ? 0 : t.status === "queued" ? 1 : 2);

/**
 * タスク一覧の中身(UI/UX①の中心): 状態フィルタ(タブ)・検索・詳細展開・
 * 追加指示/中止/引き継ぎ/新規作成・要対応バッジをまとめる。
 * 固定パネル(TasksPanel)とモバイルDrawerの両方から使う。
 */
export function TasksList({
  tasks,
  selectedTaskId,
  detailsCache,
  needsReview,
  onSelect,
  onAck,
  onCancel,
  onInstruct,
  onResume,
  onCreate,
}: TasksListProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);

  const counts = useMemo(
    () => ({
      all: tasks.length,
      running: tasks.filter((t) => t.status === "running" || t.status === "queued").length,
      review: tasks.filter(needsReview).length,
      done: tasks.filter((t) => t.status === "succeeded" || t.status === "failed" || t.status === "cancelled").length,
    }),
    [tasks, needsReview],
  );

  const visible = useMemo(() => {
    let list = tasks;
    if (filter === "running") list = list.filter((t) => t.status === "running" || t.status === "queued");
    else if (filter === "review") list = list.filter(needsReview);
    else if (filter === "done") list = list.filter((t) => t.status === "succeeded" || t.status === "failed" || t.status === "cancelled");
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((t) => t.instruction.toLowerCase().includes(q) || String(t.seq).includes(q));
    return list
      .slice()
      .sort((a, b) => rank(a) - rank(b) || b.startedAt - a.startedAt)
      .slice(0, 30);
  }, [tasks, filter, query, needsReview]);

  return (
    <>
      <HStack justify="space-between" mb="8px">
        <Text fontFamily="mono" fontSize="9px" letterSpacing="0.3em" color={PALETTE.faint}>
          TASKS
        </Text>
        <Button
          aria-label="新しいタスクを開始"
          title="新しいタスクを開始"
          size="2xs"
          variant="outline"
          bg="transparent"
          border="1px solid"
          borderColor="rgba(93, 195, 255, 0.25)"
          borderRadius="5px"
          color={PALETTE.faint}
          minW="20px"
          h="18px"
          px="0"
          fontFamily="mono"
          fontSize="11px"
          _hover={{ color: PALETTE.teal, borderColor: PALETTE.teal }}
          onClick={() => setShowNew((v) => !v)}
        >
          ＋
        </Button>
      </HStack>

      {showNew && (
        <InlineForm
          placeholder="新しいタスクの指示… (Enter)"
          onSubmit={(v) => {
            onCreate(v);
            setShowNew(false);
          }}
        />
      )}

      <Tabs.Root
        value={filter}
        onValueChange={(d) => setFilter(d.value as Filter)}
        size="sm"
        mt={showNew ? "8px" : "2px"}
        mb="8px"
        variant="plain"
      >
        <Tabs.List
          bg="rgba(0,0,0,0.25)"
          borderRadius="999px"
          p="3px"
          border="1px solid"
          borderColor="rgba(255,255,255,0.07)"
          gap="2px"
        >
          {(
            [
              ["all", "全て"],
              ["running", "実行中"],
              ["review", "要対応"],
              ["done", "完了"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <Tabs.Trigger
              key={key}
              value={key}
              fontFamily="mono"
              fontSize="9.5px"
              px="9px"
              py="3px"
              borderRadius="999px"
              color={PALETTE.faint}
              _selected={{ bg: "rgba(255,255,255,0.12)", color: PALETTE.ice }}
            >
              {label}
              {counts[key] > 0 && (
                <Text as="span" ml="4px" color={key === "review" ? PALETTE.gold : PALETTE.faint}>
                  {counts[key]}
                </Text>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="タスクを検索…"
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

      {visible.length === 0 ? (
        <Text fontSize="10px" color={PALETTE.faint} fontFamily="mono">
          {tasks.length === 0 ? "NO TASKS — ＋で追加、または話しかけてください" : "一致するタスクがありません"}
        </Text>
      ) : (
        <VStack align="stretch" gap="0">
          {visible.map((t) => {
            const review = needsReview(t);
            const selected = t.id === selectedTaskId;
            return (
              <TaskRow
                key={t.id}
                task={t}
                selected={selected}
                review={review}
                detail={detailsCache[t.id]}
                onToggle={() => {
                  if (review) onAck(t.id);
                  onSelect(selected ? null : t.id);
                }}
                onCancel={() => onCancel(t)}
                onInstruct={(text) => onInstruct(t, text)}
                onResume={(text) => onResume(t, text)}
              />
            );
          })}
        </VStack>
      )}
    </>
  );
}

export interface TasksPanelProps extends TasksListProps {
  flashKey: number;
}

/** 右上に固定表示するタスク一覧(デスクトップ)。狭幅では非表示(→MobileNavのDrawerで代替)。 */
export function TasksPanel({ flashKey, ...listProps }: TasksPanelProps) {
  return (
    <Panel
      id="panel-tasks"
      flashKey={flashKey}
      position="fixed"
      right="26px"
      top="96px"
      w="290px"
      maxH="calc(100vh - 140px)"
      display={{ base: "none", md: "block" }}
      overflowY="auto"
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      <TasksList {...listProps} />
    </Panel>
  );
}
