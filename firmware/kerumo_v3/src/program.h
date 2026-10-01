#pragma once
#include <cstdint>
#include <cstddef>
#include <cmath>

namespace kerumo {
// План і монотонний відлік не залежать від мережі, плати чи транспорту VFD.
constexpr size_t MaxProgramSteps = 8;
constexpr uint32_t MaxProgramSeconds = 86400;
constexpr uint32_t MaxScheduleSeconds = 7 * 86400;
constexpr uint64_t ProgramTransitionMs = 60000;
struct ProgramStep { double hz{}; uint32_t seconds{}; };
struct ProgramPlan { uint8_t count{}; ProgramStep steps[MaxProgramSteps]{}; };
inline bool validProgram(const ProgramPlan& plan, uint32_t maxSeconds=MaxProgramSeconds) {
  if (!plan.count || plan.count>MaxProgramSteps) return false;
  uint32_t total=0;
  for (size_t i=0;i<plan.count;++i) {
    const auto& step=plan.steps[i];
    if (!std::isfinite(step.hz) || step.hz<=0 || step.hz>100 ||
        std::fabs(step.hz*100-std::round(step.hz*100))>0.000001 || step.seconds<10 || step.seconds>maxSeconds) return false;
    total+=step.seconds;
  }
  return total<=maxSeconds;
}
enum class ProgramPhase : uint8_t { Idle, Setting, Starting, Holding, Stopping, Completed, Interrupted, Failed };
inline const char* programPhaseCode(ProgramPhase phase) {
  const char* codes[]={"idle","setting","starting","holding","stopping","completed","interrupted","failed"};
  return codes[static_cast<unsigned>(phase)];
}
struct ProgramProgress {
  bool ready{};
  char commandId[37]{};
  ProgramPhase phase{ProgramPhase::Idle};
  uint8_t step{}, count{};
  double targetHz{};
  uint32_t remainingSeconds{};
};
} // namespace kerumo
