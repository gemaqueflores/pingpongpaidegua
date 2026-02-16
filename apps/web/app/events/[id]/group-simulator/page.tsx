"use client";

import UserGroupSimulatorPage from "../../../user/events/[id]/group-simulator/page";
import { UserShell } from "../../../../components/user/UserShell";

export default function EventGroupSimulatorCanonical() {
  return (
    <UserShell>
      <UserGroupSimulatorPage />
    </UserShell>
  );
}

