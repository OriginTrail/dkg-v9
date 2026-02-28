import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

const PARTICLE_COUNT = 120;
const SPHERE_RADIUS = 1.2;
const DRIFT_SPEED = 0.15;
const ROTATION_SPEED = 0.003;

export function ParticleSphere({ size = 80 }: { size?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 4;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    const accentColor = new THREE.Color(0x3b82f6);
    const mutedColor = new THREE.Color(0x8b5cf6);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = SPHERE_RADIUS * (0.85 + Math.random() * 0.15);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      velocities[i * 3] = (Math.random() - 0.5) * DRIFT_SPEED;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * DRIFT_SPEED;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * DRIFT_SPEED;

      const mix = Math.random();
      const c = accentColor.clone().lerp(mutedColor, mix);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Connection lines between nearby particles
    const lineGeo = new THREE.BufferGeometry();
    const maxLines = PARTICLE_COUNT * 4;
    const linePositions = new Float32Array(maxLines * 6);
    const lineColors = new Float32Array(maxLines * 6);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    const CONNECTION_DIST = 0.6;

    function animate() {
      frameRef.current = requestAnimationFrame(animate);

      const posArr = geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;

        posArr[ix] += velocities[ix] * 0.01;
        posArr[iy] += velocities[iy] * 0.01;
        posArr[iz] += velocities[iz] * 0.01;

        const dist = Math.sqrt(posArr[ix] ** 2 + posArr[iy] ** 2 + posArr[iz] ** 2);
        if (dist > SPHERE_RADIUS * 1.15) {
          const scale = SPHERE_RADIUS / dist;
          posArr[ix] *= scale;
          posArr[iy] *= scale;
          posArr[iz] *= scale;
          velocities[ix] *= -0.8;
          velocities[iy] *= -0.8;
          velocities[iz] *= -0.8;
        }
      }

      geometry.attributes.position.needsUpdate = true;

      // Update connection lines
      let lineIdx = 0;
      const lp = lineGeo.attributes.position.array as Float32Array;
      const lc = lineGeo.attributes.color.array as Float32Array;

      for (let i = 0; i < PARTICLE_COUNT && lineIdx < maxLines; i++) {
        for (let j = i + 1; j < PARTICLE_COUNT && lineIdx < maxLines; j++) {
          const dx = posArr[i * 3] - posArr[j * 3];
          const dy = posArr[i * 3 + 1] - posArr[j * 3 + 1];
          const dz = posArr[i * 3 + 2] - posArr[j * 3 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (d < CONNECTION_DIST) {
            const alpha = 1 - d / CONNECTION_DIST;
            const base = lineIdx * 6;
            lp[base] = posArr[i * 3];
            lp[base + 1] = posArr[i * 3 + 1];
            lp[base + 2] = posArr[i * 3 + 2];
            lp[base + 3] = posArr[j * 3];
            lp[base + 4] = posArr[j * 3 + 1];
            lp[base + 5] = posArr[j * 3 + 2];

            const intensity = alpha * 0.6;
            lc[base] = 0.23 * intensity;
            lc[base + 1] = 0.51 * intensity;
            lc[base + 2] = 0.96 * intensity;
            lc[base + 3] = 0.23 * intensity;
            lc[base + 4] = 0.51 * intensity;
            lc[base + 5] = 0.96 * intensity;

            lineIdx++;
          }
        }
      }

      // Zero out unused lines
      for (let i = lineIdx * 6; i < maxLines * 6; i++) {
        lp[i] = 0;
        lc[i] = 0;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
      lineGeo.setDrawRange(0, lineIdx * 2);

      points.rotation.y += ROTATION_SPEED;
      points.rotation.x += ROTATION_SPEED * 0.3;
      lines.rotation.y = points.rotation.y;
      lines.rotation.x = points.rotation.x;

      renderer.render(scene, camera);
    }

    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [size]);

  return <div ref={containerRef} style={{ width: size, height: size, flexShrink: 0 }} />;
}
