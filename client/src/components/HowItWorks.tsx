import { Card } from "@/components/ui/card";
import { Phone, MessageSquare, Database } from "lucide-react";

const steps = [
  {
    number: 1,
    icon: Phone,
    title: "Patient Calls",
    description: "Your AI receptionist answers every call instantly, day or night, with natural conversation powered by GPT-5.",
    iconColor: "bg-blue-500/10 text-blue-500"
  },
  {
    number: 2,
    icon: MessageSquare,
    title: "Smart Conversation",
    description: "The AI understands patient needs, schedules appointments, answers FAQs, and handles requests professionally.",
    iconColor: "bg-green-500/10 text-green-500"
  },
  {
    number: 3,
    icon: Database,
    title: "Automatic Logging",
    description: "Every interaction is logged to your dashboard with caller info, requested service, and preferred appointment times.",
    iconColor: "bg-purple-500/10 text-purple-500"
  }
];

export default function HowItWorks() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
          How It Works
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step) => (
            <Card key={step.number} className="p-8 hover-elevate" data-testid={`card-step-${step.number}`}>
              <div className="mb-6 flex items-center gap-4">
                <div className={`w-16 h-16 rounded-full ${step.iconColor} flex items-center justify-center`}>
                  <step.icon className="w-8 h-8" />
                </div>
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                  {step.number}
                </div>
              </div>
              
              <h3 className="text-xl font-semibold mb-3" data-testid={`text-step-title-${step.number}`}>
                {step.title}
              </h3>
              
              <p className="text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
