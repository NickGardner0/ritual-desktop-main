"use client"

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";

export default function HomePage() {
  console.log('🚀 MINIMAL PAGE LOADED');
  
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    console.log('🧪 BUTTON CLICKED IN MINIMAL PAGE');
    alert('Button works!');
  };

  console.log('🎨 RENDERING MINIMAL PAGE');

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1>Minimal Test Page</h1>
        
        <button
          onClick={handleClick}
          style={{ 
            padding: '20px 40px', 
            backgroundColor: 'red', 
            color: 'white',
            fontSize: '18px',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          TEST CLICK
        </button>
        
        <Button onClick={handleClick}>
          Shadcn Button Test
        </Button>
      </div>
    </div>
  );
}