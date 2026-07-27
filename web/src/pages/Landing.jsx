import { MotionConfig, motion } from "motion/react";
import { Moon, Plus, Sun } from "lucide-react";
import { FidraGlyph } from "../components.jsx";
import { fidraConfig } from "../lib/config.js";

const ease = [0.16, 1, 0.3, 1];

function FidraLandingMark() {
  return (
    <span className="landing-brand" aria-label="Fidra">
      <FidraGlyph className="landing-logo-mark" />
      <span>Fidra</span>
    </span>
  );
}

function Landing({ navigate, theme, toggleTheme, toggleDataMode }) {
  const defaultAppRoute = fidraConfig.demoMode ? "/overview" : `/mandates/${fidraConfig.liveEvidenceMandateId}`;
  const openControlPlane = () => navigate(defaultAppRoute);

  return (
    <MotionConfig reducedMotion="user">
      <div className="landing-page">
        <motion.nav
          className="landing-nav"
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease }}
          aria-label="Landing navigation"
        >
          <div className="landing-nav-side">
            <button className="landing-logo-button" type="button" onClick={openControlPlane}><FidraLandingMark /></button>
            <button className="landing-dark-pill landing-menu-pill" type="button" onClick={openControlPlane}>
              <span className="landing-circle landing-circle-light"><Plus size={12} strokeWidth={3} /></span>
              <span>Open app</span>
            </button>
            <div className="landing-tags-pill landing-desktop-only" aria-label="Product categories">
              <span>Locked receivables</span><span>Arc + USDC</span>
            </div>
          </div>
          <div className="landing-nav-side landing-right-control">
            <button className="landing-mode-switch" type="button" onClick={toggleDataMode}>
              {fidraConfig.demoMode ? "Demo Mode" : "Live Mode"}
            </button>
            <div className="landing-tags-pill">
              <button className="landing-circle landing-circle-dark" type="button" aria-label="Open Fidra control plane" onClick={openControlPlane}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="5" r="1.4" /><circle cx="11" cy="5" r="1.4" /><circle cx="5" cy="11" r="1.4" /><circle cx="11" cy="11" r="1.4" /></svg>
              </button>
              <span className="landing-desktop-only">USDC working capital</span>
            </div>
            <button
              className="landing-circle landing-theme-toggle"
              type="button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            </button>
          </div>
        </motion.nav>

        <div className="landing-video-wrap" aria-hidden="true">
          <motion.video
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.8, ease }}
          />
        </div>

        <motion.footer
          className="landing-footer"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 1, ease }}
        >
          <div className="landing-copy">
            <motion.p className="landing-kicker" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, duration: 0.8, ease }}>
              <span />Receivables infrastructure for agentic commerce
            </motion.p>
            <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8, duration: 0.8, ease }}>
              Approved claims.<br />Instant USDC.
            </motion.h1>
            <motion.div className="landing-actions" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1, duration: 0.8, ease }}>
              <button className="landing-cta landing-cta-primary" type="button" onClick={openControlPlane}>Open control plane</button>
              <button className="landing-cta landing-cta-secondary" type="button" onClick={() => navigate(defaultAppRoute)}>How Fidra works</button>
            </motion.div>
          </div>
          <div className="landing-footer-tags">
            <span>Mandates</span><span>Irrevocable claims</span><span>Vendor advances</span>
          </div>
        </motion.footer>
      </div>
    </MotionConfig>
  );
}

export default Landing;
