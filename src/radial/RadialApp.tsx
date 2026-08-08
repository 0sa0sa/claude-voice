import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ChakraProvider } from "@chakra-ui/react";
import { radialSystem, PALETTE } from "./theme";
import { useVoiceCoreScene } from "./useVoiceCoreScene";
import { useVoiceCoreData } from "./useVoiceCoreData";
import { useVoiceCoreVoice } from "./useVoiceCoreVoice";
import type { CvIntentResult } from "./useCvIntent";
import { useMicLevel } from "../hooks/useMicLevel";
import { Masthead } from "./Masthead";
import { ConsoleDock } from "./ConsoleDock";
import { ProjectsPanel } from "./ProjectsPanel";
import { TasksPanel } from "./TasksPanel";
import { MobileNav } from "./MobileNav";
import type { VoiceCoreSceneApi } from "./useVoiceCoreScene";

/** マイクの実振幅をシーンへ流す専用の葉コンポーネント(60fpsのsetStateをここだけに閉じ込める)。 */
function MicLevelBridge({
  active,
  sceneApi,
  suppressed,
}: {
  active: boolean;
  sceneApi: React.RefObject<VoiceCoreSceneApi | null>;
  suppressed: boolean;
}) {
  const mic = useMicLevel(active, { bars: 1 });
  useEffect(() => {
    if (active && !suppressed) sceneApi.current?.setTargetLevel(mic.level);
  }, [mic.level, active, suppressed, sceneApi]);
  return null;
}

function HudCorner({ top, bottom, left, right }: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }) {
  return (
    <Box
      position="absolute"
      w="22px"
      h="22px"
      border="1px solid"
      borderColor="rgba(205, 227, 235, 0.32)"
      top={top ? "26px" : undefined}
      bottom={bottom ? "26px" : undefined}
      left={left ? "26px" : undefined}
      right={right ? "26px" : undefined}
      borderRightWidth={right ? 0 : undefined}
      borderLeftWidth={left ? 0 : undefined}
      borderBottomWidth={top ? 0 : undefined}
      borderTopWidth={bottom ? 0 : undefined}
    />
  );
}

function browserSessionId(): string {
  return "bs-radial-" + Math.random().toString(36).slice(2, 10);
}

/** claude-voice VoiceCore(radial)本体。three.jsコア + Chakra製HUDパネル。 */
function RadialAppInner() {
  const [sessionId] = useState(browserSessionId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelReadoutRef = useRef<HTMLSpanElement | null>(null);
  const sceneApi = useVoiceCoreScene(canvasRef, waveCanvasRef, levelReadoutRef);

  const [projectFlash, setProjectFlash] = useState(0);
  const [taskFlash, setTaskFlash] = useState(0);

  // useVoiceCoreData/useVoiceCoreVoice は互いの関数を必要とするため、ref経由の
  // 間接呼び出しで循環参照を避ける(App.tsxの既存パターンを踏襲)。
  const voiceApiRef = useRef<{ addSystem: (t: string) => void; speak: (t: string, o?: { urgent?: boolean }) => void }>({
    addSystem: () => {},
    speak: () => {},
  });

  const data = useVoiceCoreData({
    browserSessionId: sessionId,
    onSystemLine: (text) => voiceApiRef.current.addSystem(text),
    onAnnounce: (text, opts) => voiceApiRef.current.speak(text, opts),
    sceneApi,
  });

  const dataRef = useRef(data);
  dataRef.current = data;

  const onBeforeDispatch = useCallback((result: CvIntentResult) => {
    const d = dataRef.current;
    if (result.view.action === "task" && result.view.seq != null) {
      const t = d.tasks.find((x) => x.seq === result.view.seq);
      if (t) {
        d.selectTask(t.id);
        setTaskFlash((f) => f + 1);
      }
    } else if (result.view.action === "project" && result.view.project) {
      void d.switchProject(result.view.project);
      setProjectFlash((f) => f + 1);
    } else if (result.view.action === "collapse") {
      d.selectTask(null);
    }
  }, []);

  const projectNames = data.projects.map((p) => p.name);
  const voice = useVoiceCoreVoice({
    browserSessionId: sessionId,
    projectNames,
    sceneApi,
    onBeforeDispatch,
  });
  voiceApiRef.current = { addSystem: voice.addSystem, speak: voice.speak };

  const runningCount = data.tasks.filter((t) => t.status === "running").length;
  let statusLabel: string;
  let sysLine: string;
  let active: boolean;
  if (voice.speaking) {
    statusLabel = "speaking";
    sysLine = "SYS.CV / JA-JP / SPEAKING";
    active = true;
  } else if (voice.busy) {
    statusLabel = "linking";
    sysLine = "SYS.CV / JA-JP / THINKING";
    active = true;
  } else if (voice.listening) {
    statusLabel = "listening";
    sysLine = "SYS.CV / LIVE / LISTENING";
    active = true;
  } else {
    statusLabel = "standby";
    sysLine = `SYS.CV / JA-JP / IDLE${runningCount ? ` / RUN ${runningCount}` : ""}`;
    active = false;
  }

  return (
    <Box position="fixed" inset={0} bg={PALETTE.void} overflow="hidden" fontFamily="sans">
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, display: "block" }} />
      <MicLevelBridge active={voice.listening} sceneApi={sceneApi} suppressed={voice.speaking || voice.busy} />

      <Box position="fixed" inset={0} pointerEvents="none" display="flex" flexDirection="column" alignItems="center" justifyContent="space-between" p={{ base: "22px", md: "40px" }}>
        <HudCorner top left />
        <HudCorner top right />
        <HudCorner bottom left />
        <HudCorner bottom right />

        <Masthead sysLine={sysLine} status={statusLabel} statusActive={active} />

        <ConsoleDock
          messages={voice.messages}
          draft={voice.draft}
          setDraft={voice.setDraft}
          onSubmitDraft={voice.submitDraft}
          interim={voice.interim}
          levelReadoutRef={levelReadoutRef}
          waveCanvasRef={waveCanvasRef}
          listening={voice.listening}
          supported={voice.supported}
          ttsEnabled={voice.ttsEnabled}
          onToggleMic={() => (voice.listening ? voice.stopMic() : voice.startMic())}
          onToggleTts={voice.toggleTts}
          onStopAll={voice.stopAll}
        />
      </Box>

      <ProjectsPanel projects={data.projects} activeProject={data.activeProject} flashKey={projectFlash} onSelect={data.switchProject} />
      <TasksPanel
        tasks={data.tasks}
        selectedTaskId={data.selectedTaskId}
        detailsCache={data.detailsCache}
        needsReview={data.needsReview}
        flashKey={taskFlash}
        onSelect={data.selectTask}
        onAck={data.ackTask}
        onCancel={data.cancelTask}
        onInstruct={data.sendInstruction}
        onResume={data.resumeTask}
        onCreate={data.createTask}
      />

      <MobileNav
        projectsProps={{ projects: data.projects, activeProject: data.activeProject, onSelect: data.switchProject }}
        tasksProps={{
          tasks: data.tasks,
          selectedTaskId: data.selectedTaskId,
          detailsCache: data.detailsCache,
          needsReview: data.needsReview,
          onSelect: data.selectTask,
          onAck: data.ackTask,
          onCancel: data.cancelTask,
          onInstruct: data.sendInstruction,
          onResume: data.resumeTask,
          onCreate: data.createTask,
        }}
      />
    </Box>
  );
}

export function RadialApp() {
  return (
    <ChakraProvider value={radialSystem}>
      <RadialAppInner />
    </ChakraProvider>
  );
}
