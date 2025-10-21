import DashboardPreview from '../DashboardPreview';
import type { CallLog } from '@shared/schema';

const mockLogs: CallLog[] = [
  {
    id: "1",
    name: "Test Patient",
    phone: "123-456-7890",
    service: "Cleaning",
    preferredTime: "Tomorrow",
    status: "New",
    createdAt: new Date().toISOString()
  }
];

export default function DashboardPreviewExample() {
  return <DashboardPreview callLogs={mockLogs} onRefresh={() => console.log('Refresh clicked')} />;
}
