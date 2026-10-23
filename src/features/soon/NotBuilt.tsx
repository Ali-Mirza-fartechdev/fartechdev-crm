import { Hammer } from "lucide-react";
import { Empty } from "@/components/ui";

/** Honest placeholder: these modules' tables, RLS policies and rules already exist and are tested; their screens are not built yet. */
export function NotBuilt({ title, phase, note }: { title: string; phase: string; note: string }) {
  return (
    <div className="page">
      <div className="page-head"><div><h1>{title}</h1></div></div>
      <div className="glass card"><Empty icon={<Hammer size={32} />} title={`${title} screens are planned for ${phase}`}>{note}</Empty></div>
    </div>
  );
}
