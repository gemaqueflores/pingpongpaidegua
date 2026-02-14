import { Suspense } from "react";
import { AdminResetPasswordClient } from "./reset-password-client";

export default function AdminResetPasswordPage() {
  return (
    <Suspense fallback={<main className="container"><p>Carregando...</p></main>}>
      <AdminResetPasswordClient />
    </Suspense>
  );
}
