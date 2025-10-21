import Hero from '../Hero';

export default function HeroExample() {
  return <Hero onSimulateCall={() => console.log('Simulate call clicked')} />;
}
