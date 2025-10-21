import { Card } from "@/components/ui/card";
import { Phone, MessageSquare, Database } from "lucide-react";

const steps = [
  {
    number: 1,
    icon: Phone,
    title: "Patient Calls",
    description: "Your AI receptionist answers every call instantly, day or night, with natural conversation powered by GPT-5.",
    iconColor: "bg-[#A7F3D0] text-[#059669]"
  },
  {
    number: 2,
    icon: MessageSquare,
    title: "Smart Conversation",
    description: "The AI understands patient needs, schedules appointments, answers FAQs, and handles requests professionally.",
    iconColor: "bg-[#A7F3D0] text-[#059669]"
  },
  {
    number: 3,
    icon: Database,
    title: "Automatic Logging",
    description: "Every interaction is logged to your dashboard with caller info, requested service, and preferred appointment times.",
    iconColor: "bg-[#A7F3D0] text-[#059669]"
  }
];

export default function HowItWorks() {
  return (
    <section className="py-32 px-6 bg-white">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-24 text-[#111827]">
          How It Works
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step) => (
            <Card key={step.number} className="p-10 hover-elevate shadow-lg border-[#E5E7EB] bg-white" data-testid={`card-step-${step.number}`}>
              <div className="mb-8 flex items-center gap-4">
                <div className={`w-16 h-16 rounded-2xl ${step.iconColor} flex items-center justify-center`}>
                  <step.icon className="w-8 h-8" />
                </div>
                <div className="w-10 h-10 rounded-full bg-[#00C896] text-white flex items-center justify-center font-bold text-lg">
                  {step.number}
                </div>
              </div>
              
              <h3 className="text-2xl font-semibold mb-4 text-[#111827]" data-testid={`text-step-title-${step.number}`}>
                {step.title}
              </h3>
              
              <p className="text-[#6B7280] leading-relaxed text-lg">
                {step.description}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
