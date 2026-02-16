"use client";

import UserReportProblemPage from "../user/reportar-problema/page";
import { UserShell } from "../../components/user/UserShell";

export default function ReportarProblemaCanonicalPage() {
  return (
    <UserShell>
      <UserReportProblemPage />
    </UserShell>
  );
}

