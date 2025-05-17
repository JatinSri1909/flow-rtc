// src/app/page.tsx
import Link from "next/link";
import { pages } from "@/constants";

export default function Home() {
  return (
    <div className="bg-black min-h-screen flex flex-col items-center justify-center p-6">
      <h1 className="text-5xl sm:text-7xl font-bold text-center text-white mb-5">FlowRTC</h1>
      <p className="px-5 py-3 text-center text-lg sm:text-xl text-white mb-8">
        Connect, Interact, and Engage – Live Streaming, Redefined.
      </p>
      <div className="flex flex-wrap justify-center gap-6">
        {pages.map((page, index) => (
          <div key={index} className="flex flex-col items-center gap-4 bg-black rounded-lg p-6 max-w-sm border border-white shadow-lg transition-transform transform hover:scale-105">
            <page.icon className="w-12 h-12 text-white" />
            <div className="text-center">
              <h2 className="text-xl font-semibold text-white">{page.title}</h2>
              <p className="text-white mb-4">{page.description}</p>
              <Link href={page.href} className="bg-white text-black px-5 py-2 rounded-md transition duration-300 hover:bg-gray-200">
                {page.button}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}