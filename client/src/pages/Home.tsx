import { useState, useEffect } from 'react';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import DashboardPreview from '@/components/DashboardPreview';
import ConnectClinic from '@/components/ConnectClinic';
import CallSimulationModal from '@/components/CallSimulationModal';
import Footer from '@/components/Footer';
import { useToast } from '@/hooks/use-toast';
import type { CallLog } from '@shared/schema';

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  const fetchCallLogs = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/calls/all');
      if (response.ok) {
        const data = await response.json();
        setCallLogs(data.rows);
      }
    } catch (error) {
      console.error('Error fetching calls:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCallLogs();
  }, []);

  const handleLogCall = async () => {
    await fetchCallLogs();
    toast({
      title: "Sent to clinic (demo)",
      description: "Call has been logged successfully.",
      duration: 3000,
    });
  };

  const handleRefresh = async () => {
    await fetchCallLogs();
    toast({
      title: "Dashboard refreshed",
      description: "Showing latest call logs",
      duration: 2000,
    });
  };

  return (
    <div className="min-h-screen">
      <Hero onSimulateCall={() => setIsModalOpen(true)} />
      <HowItWorks />
      <DashboardPreview callLogs={callLogs} onRefresh={handleRefresh} isRefreshing={isRefreshing} />
      <ConnectClinic />
      <Footer />
      <CallSimulationModal 
        open={isModalOpen} 
        onOpenChange={setIsModalOpen}
        onLogCall={handleLogCall}
      />
    </div>
  );
}
