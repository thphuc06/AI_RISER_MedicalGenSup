import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeMicSphereProps {
  isListening?: boolean;
}

export const ThreeMicSphere: React.FC<ThreeMicSphereProps> = ({ isListening = true }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 240;
    const height = container.clientHeight || 240;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Clear previous children
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // Microphone Body - Large teal sphere
    const geometry = new THREE.SphereGeometry(2.5, 32, 32);
    const material = new THREE.MeshPhongMaterial({
      color: 0x00685c, // Primary teal color
      shininess: 90,
      transparent: true,
      opacity: 0.95,
    });
    const micBody = new THREE.Mesh(geometry, material);
    scene.add(micBody);

    // Inner glowing core
    const coreGeo = new THREE.SphereGeometry(1.8, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x218274,
      transparent: true,
      opacity: 0.6,
    });
    const micCore = new THREE.Mesh(coreGeo, coreMat);
    scene.add(micCore);

    // Pulsing Outer Rings
    const createRing = (radius: number, opacity: number) => {
      const ringGeo = new THREE.TorusGeometry(radius, 0.04, 16, 100);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x218274,
        transparent: true,
        opacity: opacity,
      });
      return new THREE.Mesh(ringGeo, ringMat);
    };

    const ring1 = createRing(3.2, 0.4);
    const ring2 = createRing(3.6, 0.25);
    const ring3 = createRing(4.1, 0.15);
    scene.add(ring1);
    scene.add(ring2);
    scene.add(ring3);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x9af3e2, 1.2);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0x00201b, 0.8);
    backLight.position.set(-5, -5, -5);
    scene.add(backLight);

    camera.position.z = 8.5;

    let reqId: number;

    const animate = () => {
      reqId = requestAnimationFrame(animate);

      const time = Date.now() * 0.0025;

      if (isListening) {
        // Floating motion
        micBody.position.y = Math.sin(time) * 0.18;
        micCore.position.y = Math.sin(time) * 0.18;

        // Pulse effect for rings
        const pulse1 = 1 + Math.sin(time * 2.8) * 0.12;
        ring1.scale.set(pulse1, pulse1, 1);
        ring1.material.opacity = 0.45 * (1 - (pulse1 - 1) / 0.12);

        const pulse2 = 1 + Math.sin(time * 2.8 + 0.6) * 0.18;
        ring2.scale.set(pulse2, pulse2, 1);
        ring2.material.opacity = 0.25 * (1 - (pulse2 - 1) / 0.18);

        const pulse3 = 1 + Math.sin(time * 2.8 + 1.2) * 0.22;
        ring3.scale.set(pulse3, pulse3, 1);
        ring3.material.opacity = 0.15 * (1 - (pulse3 - 1) / 0.22);

        micBody.rotation.y += 0.005;
      } else {
        micBody.position.y = 0;
        micCore.position.y = 0;
        ring1.scale.set(1, 1, 1);
        ring2.scale.set(1, 1, 1);
        ring3.scale.set(1, 1, 1);
        ring1.material.opacity = 0.1;
        ring2.material.opacity = 0.05;
        ring3.material.opacity = 0.02;
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener('resize', handleResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      renderer.dispose();
    };
  }, [isListening]);

  return (
    <div
      ref={mountRef}
      className="w-[220px] h-[220px] sm:w-[240px] sm:h-[240px] relative flex items-center justify-center cursor-pointer"
      title="3D Voice Visualizer"
    />
  );
};
