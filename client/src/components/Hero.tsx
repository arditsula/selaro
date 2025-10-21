import { Button } from "@/components/ui/button";
import { Phone, LayoutDashboard } from "lucide-react";
import heroImage from "@assets/generated_images/Dental_clinic_hero_background_16079e81.png";

interface HeroProps {
  onSimulateCall: () => void;
}

export default function Hero({ onSimulateCall }: HeroProps) {
  const scrollToDashboard = () => {
    document.getElementById('dashboard-preview')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div 
        className="absolute inset-0 z-0 bg-gradient-to-br from-[#F9FAFB] via-[#F0FDF9] to-[#ECFDF5]"
      >
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-gradient-to-br from-emerald-300/40 to-teal-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-32 right-1/4 w-[500px] h-[500px] bg-gradient-to-tr from-green-200/30 to-emerald-300/40 rounded-full blur-3xl" />
      </div>
      
      <div className="relative z-10 max-w-5xl mx-auto px-6 py-32 text-center">
        <h1 className="text-6xl md:text-8xl font-bold tracking-tight text-[#111827] mb-8 leading-tight">
          Your 24/7 AI Receptionist for Dental Clinics
        </h1>
        
        <p className="text-lg md:text-xl text-[#4B5563] max-w-2xl mx-auto mb-16 leading-relaxed font-light">
          Never miss a patient call again. Our AI receptionist handles appointments, 
          answers questions, and logs every interaction—even after hours.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button 
            size="lg"
            className="gap-2 text-lg px-8 py-7 bg-[#00C896] hover:bg-[#00B386] text-white border-0 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
            onClick={onSimulateCall}
            data-testid="button-simulate-call"
          >
            <Phone className="w-5 h-5" />
            Simulate a Call
          </Button>
          
          <Button 
            size="lg"
            variant="outline"
            className="gap-2 text-lg px-8 py-7 bg-white border-2 border-[#E5E7EB] text-[#111827] hover:border-[#00C896] hover:bg-[#F9FAFB] hover:scale-105 transition-all duration-200 shadow-md"
            onClick={scrollToDashboard}
            data-testid="button-dashboard-preview"
          >
            <LayoutDashboard className="w-5 h-5" />
            See Dashboard Preview
          </Button>
        </div>
      </div>
    </section>
  );
}
