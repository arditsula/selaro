import { useState } from 'react';
import CallSimulationModal from '../CallSimulationModal';
import { Button } from '@/components/ui/button';

export default function CallSimulationModalExample() {
  const [open, setOpen] = useState(false);
  
  return (
    <div className="p-8">
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <CallSimulationModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
