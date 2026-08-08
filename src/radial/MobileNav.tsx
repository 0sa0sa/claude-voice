import { useState } from "react";
import { Box, Drawer, HStack, Portal } from "@chakra-ui/react";
import { ProjectsList } from "./ProjectsPanel";
import type { ProjectsListProps } from "./ProjectsPanel";
import { TasksList } from "./TasksPanel";
import type { TasksListProps } from "./TasksPanel";
import { PALETTE } from "./theme";

function NavButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box
      as="button"
      onClick={onClick}
      pointerEvents="auto"
      bg="rgba(6, 16, 32, 0.6)"
      border="1px solid"
      borderColor="rgba(93, 195, 255, 0.25)"
      borderRadius="8px"
      color={PALETTE.dim}
      fontFamily="mono"
      fontSize="10px"
      letterSpacing="0.1em"
      px="10px"
      py="6px"
      backdropFilter="blur(10px)"
      _hover={{ color: PALETTE.teal, borderColor: PALETTE.teal }}
    >
      {label}
    </Box>
  );
}

function DrawerPanel({
  open,
  onOpenChange,
  placement,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement: "start" | "end";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={(d) => onOpenChange(d.open)} placement={placement} size="xs">
      <Portal>
        <Drawer.Backdrop bg="rgba(0,0,0,0.5)" />
        <Drawer.Positioner>
          <Drawer.Content bg="rgba(6, 12, 24, 0.96)" color={PALETTE.dim} fontFamily="mono" backdropFilter="blur(16px)">
            <Drawer.Header borderBottom="1px solid" borderColor={PALETTE.hairline}>
              <Drawer.Title fontFamily="mono" fontSize="11px" letterSpacing="0.2em" color={PALETTE.ice}>
                {title}
              </Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <Box as="button" position="absolute" top="10px" right="12px" color={PALETTE.faint} fontSize="16px" _hover={{ color: PALETTE.teal }}>
                  ✕
                </Box>
              </Drawer.CloseTrigger>
            </Drawer.Header>
            <Drawer.Body py="14px">{children}</Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}

export interface MobileNavProps {
  projectsProps: ProjectsListProps;
  tasksProps: TasksListProps;
}

/**
 * UI/UX③(レスポンシブ): 狭幅ではPROJECTS/TASKSの固定パネルを隠す代わりに、
 * 画面上部の小さなトリガーからDrawerで同じ内容を開けるようにする。
 */
export function MobileNav({ projectsProps, tasksProps }: MobileNavProps) {
  const [openProjects, setOpenProjects] = useState(false);
  const [openTasks, setOpenTasks] = useState(false);

  return (
    <>
      <HStack position="fixed" top="14px" left="14px" right="14px" justify="space-between" zIndex={9} display={{ base: "flex", md: "none" }}>
        <NavButton label="プロジェクト" onClick={() => setOpenProjects(true)} />
        <NavButton label="タスク" onClick={() => setOpenTasks(true)} />
      </HStack>

      <DrawerPanel open={openProjects} onOpenChange={setOpenProjects} placement="start" title="PROJECTS">
        <ProjectsList
          {...projectsProps}
          onSelect={(name) => {
            projectsProps.onSelect(name);
            setOpenProjects(false);
          }}
        />
      </DrawerPanel>

      <DrawerPanel open={openTasks} onOpenChange={setOpenTasks} placement="end" title="TASKS">
        <TasksList {...tasksProps} />
      </DrawerPanel>
    </>
  );
}
