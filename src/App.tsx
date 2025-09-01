import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, type JSX } from "react";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import NewAssessment from "./pages/NewAssessment";
import Profile from "./pages/Profile";

function Protected({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!authed) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/new" element={<Protected><NewAssessment /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
      <Route path="/profile" element={<Protected><Profile/></Protected>} />
    </Routes>
  );
}
