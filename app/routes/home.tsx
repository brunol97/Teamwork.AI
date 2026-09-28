import { useEffect } from "react";
import { useNavigate } from "react-router";

export default function HomeRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/tasks", { replace: true });
  }, [navigate]);

  return null;
}
