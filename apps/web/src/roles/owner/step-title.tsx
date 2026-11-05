import { Badge } from '../../components/ui/badge';
import { CardTitle } from '../../components/ui/card';

export function StepTitle({ title, done }: { title: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <CardTitle>{title}</CardTitle>
      {done ? <Badge tone="primary">Done · ተጠናቋል</Badge> : <Badge>To do</Badge>}
    </div>
  );
}
