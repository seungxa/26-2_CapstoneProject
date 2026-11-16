import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../../index.css";
import "../styles.css";
import GazeDirectionLab from "../pages/GazeDirectionLab";
import { GAZE_LAB } from "../video/debug";

/** 카메라가 있는 노트북에서 시선 방향 실측만 하기 위한 단독 화면. 앱 셸·로그인·연습 서버를 거치지 않는다.
 *  실험실은 프레임과 특징점을 이 탭 메모리에서만 계산하므로 서버가 필요 없다. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="practice-track" lang="ko">
      <div className="pt-content">
        {GAZE_LAB ? <GazeDirectionLab /> : <p role="alert">This lab runs only from scripts/practice-track/start-gaze-lab.mjs.</p>}
      </div>
    </div>
  </StrictMode>,
);
