import { Outlet } from "react-router";

/**
 * Layout voor /tasks. De takenlijst staat in tasks._index.tsx, de taakpagina met
 * het werkdocument in tasks.$taskId.tsx.
 */
export default function TasksLayout() {
  return <Outlet />;
}
